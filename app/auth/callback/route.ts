import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const oauthError = searchParams.get("error_description");
  const next = searchParams.get("next") ?? "/";

  if (oauthError) {
    console.error("OAuth error:", oauthError);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const redirectTo = next.startsWith("/") ? next : "/";
  let response = NextResponse.redirect(`${origin}${redirectTo}`);

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("exchangeCodeForSession:", error.message, error.name);
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  return response;
}
