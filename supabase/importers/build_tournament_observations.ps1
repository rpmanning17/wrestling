param(
    [Parameter(Mandatory = $true)]
    [string]$TsvPath,

    [int]$Offset = 0,

    [int]$Limit = 150
)

function ConvertTo-SqlLiteral {
    param([AllowEmptyString()][AllowNull()][string]$Value)

    if ($null -eq $Value) {
        return 'null'
    }

    return "'" + $Value.Replace("'", "''") + "'"
}

function ConvertTo-NullableSqlLiteral {
    param([AllowEmptyString()][AllowNull()][string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return 'null'
    }

    return ConvertTo-SqlLiteral $Value
}

function Get-DivisionMetadata {
    param([string]$DivisionLabel)

    $isGirls = $DivisionLabel.StartsWith('Girls')
    $isRookie = $DivisionLabel.Contains('Rookie')
    $isHighSchool = $DivisionLabel.Contains('HS ')
    $years = [regex]::Matches($DivisionLabel, '(?:19|20)\d{2}') | ForEach-Object { [int]$_.Value }

    $ageGroup = switch -Regex ($DivisionLabel) {
        '2012/2013' { '14U'; break }
        '2014/2015' { '12U'; break }
        '2016/2017' { '10U'; break }
        '2018/2019' { '8U'; break }
        default { $null }
    }

    [pscustomobject]@{
        Gender = if ($isGirls) { 'girls' } else { 'boys' }
        Basis = if ($isHighSchool) { 'school_level' } else { 'birth_year_band' }
        AgeGroup = $ageGroup
        BirthYearStart = if ($years.Count -gt 0) { ($years | Measure-Object -Minimum).Minimum } else { $null }
        BirthYearEnd = if ($years.Count -gt 0) { ($years | Measure-Object -Maximum).Maximum } else { $null }
        Experience = if ($isHighSchool) { $null } elseif ($isRookie) { 'rookie' } else { 'open' }
        SchoolLevel = if ($DivisionLabel -eq 'Boys HS JV') { 'junior_varsity' } elseif ($isHighSchool) { 'varsity' } else { $null }
    }
}

$sourceZipSha256 = '2E83D4B289F5853BF98C17E75DA076745CB52C1FEEF3355EBA6CF31E07D6F937'
$rows = Import-Csv -LiteralPath $TsvPath -Delimiter "`t" | Select-Object -Skip $Offset -First $Limit

$values = foreach ($row in $rows) {
    $division = Get-DivisionMetadata $row.division_label
    $placement = [int]([regex]::Match($row.placement, '^\d+').Value)
    $weightLbs = if ($row.weight_label -match '^\d+(?:\.\d+)?$') { $row.weight_label } else { 'null' }
    $placersFile = "www.flowrestling.org_events_2YUVrvk4gaOQX69d_results_filter=$($row.filter_id)&tab=placers.png"
    $weightFile = "www.flowrestling.org_events_2YUVrvk4gaOQX69d_results_filter=$($row.filter_id)&tab=weight.png"
    $sourceKey = "fall26:$($row.filter_id):$($row.weight_label):${placement}:$($row.athlete_name.ToLowerInvariant())"

    $fields = @(
        (ConvertTo-SqlLiteral $row.filter_id)
        (ConvertTo-SqlLiteral $row.division_label)
        (ConvertTo-SqlLiteral $row.weight_label)
        $placement
        (ConvertTo-SqlLiteral $row.athlete_name)
        (ConvertTo-SqlLiteral $row.team)
        (ConvertTo-SqlLiteral $division.Gender)
        (ConvertTo-SqlLiteral $division.Basis)
        (ConvertTo-NullableSqlLiteral $division.AgeGroup)
        $(if ($null -eq $division.BirthYearStart) { 'null' } else { $division.BirthYearStart })
        $(if ($null -eq $division.BirthYearEnd) { 'null' } else { $division.BirthYearEnd })
        (ConvertTo-NullableSqlLiteral $division.Experience)
        (ConvertTo-NullableSqlLiteral $division.SchoolLevel)
        $weightLbs
        (ConvertTo-SqlLiteral $placersFile)
        (ConvertTo-SqlLiteral $weightFile)
        (ConvertTo-SqlLiteral $sourceZipSha256)
        (ConvertTo-SqlLiteral $sourceKey)
    )

    '(' + ($fields -join ',') + ')'
}

if ($values.Count -eq 0) {
    exit 0
}

$sql = @"
with incoming (
  source_filter_id, division_label, bracket_weight_label, placement,
  athlete_name, team, division_gender, division_basis, age_group,
  birth_year_start, birth_year_end, experience_division, school_level,
  bracket_weight_lbs, source_placers_file, source_weight_file,
  source_zip_sha256, source_key
) as (
  values
$($values -join ",`n")
),
classified as (
  select incoming.*,
    case
      when lower(trim(incoming.athlete_name)) in ('forfeit', 'bye') then 'placeholder'
      when exists (
        select 1 from public.tournament_entries entry
        where lower(trim(entry.athlete_name)) = lower(trim(incoming.athlete_name))
      ) or exists (
        select 1 from public.matches match
        where lower(trim(match.winner_name)) = lower(trim(incoming.athlete_name))
           or lower(trim(match.loser_name)) = lower(trim(incoming.athlete_name))
      ) then 'exact_existing'
      else 'new_identity'
    end as identity_resolution
  from incoming
),
observed as (
  insert into public.tournament_observations (
    event_date, event_end_date, event_name, city, state, athlete_name, team,
    division_label, division_gender, division_basis, age_group,
    eligibility_birth_year_start, eligibility_birth_year_end,
    experience_division, school_level, bracket_weight_label,
    bracket_weight_lbs, placement, placement_verified, identity_resolution,
    source_filter_id, source_placers_file, source_weight_file,
    source_zip_sha256, extraction_method, confidence, notes
  )
  select
    date '2026-10-31', date '2026-11-01', 'Juggernaut Fall Championships',
    'Wellington', 'FL', athlete_name, team, division_label, division_gender,
    division_basis, age_group, birth_year_start, birth_year_end,
    experience_division, school_level, bracket_weight_label,
    bracket_weight_lbs, placement, true, identity_resolution,
    source_filter_id, source_placers_file, source_weight_file,
    source_zip_sha256, 'screenshot_and_live_table', 'confirmed',
    'Division and bracket labels are eligibility/class evidence, not exact birth year or body weight.'
  from classified
  on conflict on constraint tournament_observations_source_unique do update set
    team = excluded.team,
    placement_verified = true,
    identity_resolution = excluded.identity_resolution,
    source_placers_file = excluded.source_placers_file,
    source_weight_file = excluded.source_weight_file,
    source_zip_sha256 = excluded.source_zip_sha256,
    updated_at = now()
  returning id
),
promoted as (
  insert into public.tournament_entries (
    event_date, event_name, city, state, athlete_name, team, division_label,
    age_group, division_birth_year_start, division_birth_year_end,
    experience_division, bracket_weight_lbs, placement, placement_basis,
    confidence, source_file, source_key
  )
  select
    date '2026-10-31', 'Juggernaut Fall Championships', 'Wellington', 'FL',
    incoming.athlete_name, incoming.team, incoming.division_label,
    incoming.age_group, incoming.birth_year_start, incoming.birth_year_end,
    incoming.experience_division, incoming.bracket_weight_lbs,
    incoming.placement, 'reported', 'confirmed',
    incoming.source_placers_file, incoming.source_key
  from incoming
  where incoming.age_group is not null
    and incoming.birth_year_start is not null
    and incoming.birth_year_end is not null
    and incoming.bracket_weight_lbs is not null
    and lower(trim(incoming.athlete_name)) not in ('forfeit', 'bye')
    and not exists (
      select 1
      from public.tournament_entries entry
      where entry.event_date = date '2026-10-31'
        and lower(trim(entry.event_name)) = lower('Juggernaut Fall Championships')
        and lower(trim(entry.athlete_name)) = lower(trim(incoming.athlete_name))
        and lower(trim(entry.division_label)) = lower(trim(incoming.division_label))
        and entry.bracket_weight_lbs = incoming.bracket_weight_lbs
    )
  on conflict on constraint tournament_entries_source_unique do nothing
  returning id
),
linked as (
  update public.tournament_observations observation
  set resolved_entry_id = entry.id, updated_at = now()
  from public.tournament_entries entry, incoming
  where observation.source_filter_id = incoming.source_filter_id
    and observation.bracket_weight_label = incoming.bracket_weight_label
    and observation.placement = incoming.placement
    and lower(trim(observation.athlete_name)) = lower(trim(incoming.athlete_name))
    and entry.event_date = date '2026-10-31'
    and lower(trim(entry.event_name)) = lower('Juggernaut Fall Championships')
    and lower(trim(entry.athlete_name)) = lower(trim(incoming.athlete_name))
    and lower(trim(entry.division_label)) = lower(trim(incoming.division_label))
    and entry.bracket_weight_lbs = incoming.bracket_weight_lbs
  returning observation.id
)
select
  (select count(*) from observed) as observations_upserted,
  (select count(*) from promoted) as entries_promoted,
  (select count(*) from linked) as observations_linked;
"@

$sql
