"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// Counts client-side page views in this tab. It lives in module scope, so it resets on a full page load:
// a page opened from a new tab or a pasted link starts at 1 and has no in-app page to go back to.
let pagesSeen = 0;

/** Call once in the app shell so every in-app navigation is counted. */
export function useTrackPageViews() {
  const pathname = usePathname();
  useEffect(() => { pagesSeen += 1; }, [pathname]);
}

/** Returns to the previous in-app page, or to `href` when there is none. */
export function BackLink({ href, label }: { href: string; label: string }) {
  const router = useRouter();
  return <Link className="back-link" href={href} onClick={(event) => {
    if (pagesSeen > 1) { event.preventDefault(); router.back(); }
  }}>← {label}</Link>;
}
