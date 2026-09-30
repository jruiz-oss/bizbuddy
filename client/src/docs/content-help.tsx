import { Link } from "wouter";
import type { Article } from "./types";
import { H2, P, UL, Steps, B, Code, Callout, Table } from "./parts";

const A = ({ to, children }: { to: string; children: React.ReactNode }) => (
  <Link href={to} className="text-sky-700 underline underline-offset-2">{children}</Link>
);

export const helpArticles: Article[] = [
  {
    slug: "google-connection",
    group: "Troubleshooting",
    title: "Google connection expired",
    description: "The amber banner, what it means, and how to fix it.",
    body: () => (
      <>
        <P>
          Symptom: an amber bar across the top says <B>"The shared Google connection expired and needs to be reconnected."</B> Posting, hours and syncing fail, but you can still log in and browse.
        </P>
        <H2 id="fix">Fix</H2>
        <Steps>
          <li>Click <B>Reconnect Google</B> in the banner.</li>
          <li>Sign in with the agency Google account and accept all permissions.</li>
          <li>You land back in BizBuddy. The banner clears within about a minute (it re-checks every 60 seconds and when you switch back to the tab).</li>
        </Steps>
        <P>Anyone signed in can reconnect. If you are locked out of the login screen, go to <Code>/connect-google</Code>.</P>
        <Callout tone="warn" title="Google says the account is not allowed">
          <P>Only approved Google accounts can reconnect. If you get sent back to the login page with no message, you used an account that is not on the allow list. Try the agency account or ask a super admin.</P>
        </Callout>
        <H2 id="why">Why it happens</H2>
        <P>BizBuddy holds one Google sign in for the whole agency. Google can invalidate it if the password changes, access is revoked, or the token sits unused too long. Reconnecting creates a fresh one.</P>
        <H2 id="related">Related symptoms</H2>
        <UL>
          <li>Locations page banner: "Your Google connection has expired. Reconnect to refresh location data."</li>
          <li>Pins showing <B>Needs re-auth</B>.</li>
          <li>Error "No shared Google connection" means Google was never connected at all.</li>
        </UL>
      </>
    ),
  },
  {
    slug: "failed-jobs",
    group: "Troubleshooting",
    title: "A job failed or partly failed",
    description: "Posts, hours or photos that did not go through everywhere.",
    body: () => (
      <>
        <H2 id="triage">Triage</H2>
        <Steps>
          <li>Open the job from <B>Needs your attention</B> on the Dashboard, or from the Activity log.</li>
          <li>Read the error on the failed locations.</li>
          <li>Match it to a cause below, fix it, and rerun for just the failed locations.</li>
        </Steps>
        <H2 id="causes">Common causes</H2>
        <Table
          head={["Error", "Likely cause", "Fix"]}
          rows={[
            ["Authentication or invalid grant, 401, 403", "Shared Google connection expired.", <><A to="/docs/google-connection">Reconnect Google</A>, then retry.</>],
            ["Rate limit or 429", "Too many requests to Google at once.", "Wait a few minutes, then retry the failed ones."],
            ["Location suspended or disabled", "Google suspended the profile.", "Resolve it inside Google Business Profile. BizBuddy cannot fix it."],
            ["HEIC/HEIF format not supported", "iPhone photo format.", "Convert to JPG or PNG."],
            ["Image too small", "Photo under 250 by 250 px.", "Use a larger image."],
            ["Validation Error", "Missing description, missing button link, or no location chosen.", "Fill the missing field."],
          ]}
        />
        <Callout tone="tip">
          <P>On a failed post, use Retry This Job from the Dashboard. It fills the Posts form with the same content so you only need to review and publish.</P>
        </Callout>
      </>
    ),
  },
  {
    slug: "login-problems",
    group: "Troubleshooting",
    title: "Can't sign in",
    description: "Password, lockout and invite code problems.",
    body: () => (
      <>
        <Table
          head={["What you see", "What to do"]}
          rows={[
            ["Incorrect password", "Try again, or use Forgot password?."],
            ["Too many login attempts", "Wait the number of minutes shown. Limits are per person and per network."],
            ["Invalid or already used invite code", "Invite codes work once. Ask a super admin for a new one."],
            ["Account creation fails on password", "Use 10 or more characters and avoid common words."],
            ["Session expired, please log in again", "Sign in again. Sessions last 7 days."],
            ["Reset link does not work", "Links expire after 1 hour. Request a new one."],
            ["Account creation says it could not set up your account", "Your name has to match how a super admin added you in the Team list, and the invite code has to be unused."],
          ]}
        />
        <Callout tone="note" title="A dead Google connection does not block login">
          <P>If the amber banner is showing, you can still sign in. Only Google actions are affected.</P>
        </Callout>
      </>
    ),
  },
  {
    slug: "errors",
    group: "Troubleshooting",
    title: "Error message index",
    description: "Look up the exact message you are seeing.",
    body: () => (
      <>
        <Table
          head={["Message", "Meaning and fix"]}
          rows={[
            ["Your Google connection has expired", <>Reconnect Google. <A to="/docs/google-connection">Steps</A>.</>],
            ["No shared Google connection", "Google was never connected. Any signed in user can connect it once."],
            ["Only super admins can disconnect Google", "Revoke Auth is super admin only."],
            ["A scan is already running", "Another Suggested Edits scan is active. Wait or view it with the progress pill."],
            ["Scan was interrupted", "The server restarted mid scan. Run it again."],
            ["Can only cancel scheduled posts", "The post already started or finished."],
            ["HEIC/HEIF format not supported", "Convert the photo to JPG or PNG."],
            ["Image too small", "Minimum 250 by 250 px."],
            ["Partial Sync to Google", "Some locations rejected the social links. Check the platform is valid for that location type."],
            ["Hours changes on Google cannot be automatically reverted", "Re-run an hours update with the previous hours."],
            ["Name and recipient email are required", "Fill both fields on the review email group form."],
            ["This version of the app is out of date. Reload the page", "Refresh the browser."],
            ["This link appears to be invalid or expired", "On the Copy Review page. Ask for a fresh review email."],
          ]}
        />
      </>
    ),
  },
  {
    slug: "known-limitations",
    group: "Reference",
    title: "Known limitations",
    description: "Things that do not work the way you might expect.",
    body: () => (
      <>
        <UL>
          <li><B>Photo uploads can show success without reaching Google.</B> Always verify on Google.</li>
          <li><B>No recurring posts.</B> Only one time scheduled posts.</li>
          <li><B>Regular hours replace everything</B> and do not support split shifts.</li>
          <li><B>Hours and photo jobs cannot be reverted</B> from the Activity log, even though the button appears to work.</li>
          <li><B>Social links cannot be cleared</B> by leaving a field blank.</li>
          <li><B>Fetching reviews overwrites</B> a location's saved rating and count with the fetched subset.</li>
          <li><B>Apple Maps is storage only.</B> Nothing is pushed to Apple.</li>
          <li><B>Some Settings controls are placeholders:</B> notification toggles, two factor, theme, compact mode and rate limit fields are saved but not used yet.</li>
          <li><B>Dashboard Undo This Job</B> may fail. Use the Activity log.</li>
        </UL>
      </>
    ),
  },
  {
    slug: "settings-guide",
    group: "Reference",
    title: "Settings reference",
    description: "What each part of Settings does.",
    body: () => (
      <>
        <H2 id="general">General tab</H2>
        <UL>
          <li><B>Profile:</B> full name, email and time zone (Phoenix, New York, Chicago, Los Angeles). Click <B>Save Changes</B>.</li>
          <li><B>Weekly Review Email Groups:</B> see <A to="/docs/review-emails">Scheduled review emails</A>.</li>
          <li><B>Location Auto-Sync:</B> shows Last Synced and Next Sync. To sync now, use <B>Sync from Google</B> on the Locations page.</li>
        </UL>
        <H2 id="developer">Developer tab</H2>
        <UL>
          <li><B>Developer Mode:</B> shows an amber banner on every page so you know it is on. Use <B>Disable</B> in the banner to turn it off.</li>
          <li><B>Revoke Auth:</B> disconnects Google for the whole agency. Super admins only. Do not use it unless you mean to.</li>
          <li><B>Re-login:</B> signs you out and restarts Google sign in.</li>
          <li><B>Test Error Modal:</B> shows what an error pop up looks like.</li>
        </UL>
        <Callout tone="warn" title="Revoke Auth affects everyone">
          <P>Revoking breaks posting, hours and syncing for the whole team until someone reconnects.</P>
        </Callout>
      </>
    ),
  },
];
