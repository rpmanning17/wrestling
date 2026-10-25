"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabase, configured } from "@/lib/supabase";
export async function login(form:FormData){
 if(!configured()) redirect("/login?error=setup");
 const db=await supabase();
 const {error}=await db.auth.signInWithPassword({email:String(form.get("email")??"").trim(),password:String(form.get("password")??"")});
 if(error) redirect("/login?error=signin");
 redirect("/");
}
export async function signOut(){const db=await supabase();await db.auth.signOut();redirect("/login");}
export async function addResult(form:FormData){
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const field=(key:string,max:number,required=true)=>{const value=String(form.get(key)??"").trim();if((required&&!value)||value.length>max)throw new Error("Invalid field");return value;};
 let row;
 try{
 const event_date=field("event_date",10);if(!/^\d{4}-\d{2}-\d{2}$/.test(event_date)||Number.isNaN(Date.parse(event_date)))throw new Error("Date");
 const outcome=field("outcome",4);if(!["Win","Loss","Draw"].includes(outcome))throw new Error("Outcome");
 const source_url=field("source_url",2048,false);if(source_url&&new URL(source_url).protocol!=="https:")throw new Error("URL");
 row={owner_id:user.id,athlete:field("athlete",100),opponent:field("opponent",100),event_name:field("event_name",160),division:field("division",80),season:field("season",20),event_date,outcome,method:field("method",80,false),source_url:source_url||null};
 }catch{redirect("/?error=validation");}
 const {error}=await db.from("results").insert(row);if(error)redirect("/?error=save");revalidatePath("/");redirect("/");
}
export async function deleteResult(form:FormData){
 const db=await supabase();const {data:{user}}=await db.auth.getUser();if(!user)redirect("/login");
 const {error}=await db.from("results").delete().eq("id",String(form.get("id"))).eq("owner_id",user.id);
 if(error)redirect("/?error=delete");revalidatePath("/");
}

