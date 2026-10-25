import { login } from "../actions";
export default async function Login({searchParams}:{searchParams:Promise<{error?:string}>}){
 const {error}=await searchParams;
 return <main className="login"><span className="badge">MAT NOTES · INVITATION ONLY</span><h1>Welcome to<br/>your corner.</h1><p>Your private wrestling results notebook.</p><section><h2>Sign in</h2>{error&&<p role="alert">Sign-in unavailable. Check credentials or complete database setup.</p>}<form action={login}><label>Email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label><label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label><button>Enter workspace</button></form><p>Accounts are created by the owner. Contact them for access or a password reset.</p></section></main>;
}

