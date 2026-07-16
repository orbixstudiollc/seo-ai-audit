import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// No landing page in the open-source/BYOK pivot: the root just routes into the
// dashboard when signed in, or to login otherwise. The real gate lives in the
// dashboard layout and middleware — this is only the entry redirect.
export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });
  redirect(session ? "/app" : "/login");
}
