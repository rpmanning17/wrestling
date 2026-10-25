import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Mat Notes | Private wrestling notebook",description:"Private wrestling match preparation",robots:{index:false,follow:false}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}

