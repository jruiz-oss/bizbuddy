import { Link } from "wouter";
import type { Article } from "./types";
import { H2, H3, P, UL, Steps, B, Code, Callout, Table } from "./parts";

export const startArticles: Article[] = [
  {
    slug: "intro",
    group: "Get started",
    title: "Intro to BizBuddy",
    description: "What BizBuddy does and how the app is laid out.",
    body: () => (
      <>
        <P>
          BizBuddy is our internal tool for managing every client's Google Business Profile locations in bulk. You pick the
          locations, make one change, and BizBuddy pushes it to all of them. Everything is done through the interface, there are no CSV uploads.
        </P>
        <H2 id="what-you-can-do">What you can do</H2>
        <UL>
          <li><B>Hours:</B> replace regular hours or add holiday and special hours across many locations at once.</li>
          <li><B>Posts:</B> publish or schedule a Google post to any set of locations.</li>
          <li><B>Social links:</B> set Facebook, Instagram, X and other profile links in bulk.</li>
          <li><B>Suggested Edits:</B> scan for changes Google or the public suggested, then accept or reject them.</li>
          <li><B>Reviews:</B> pull low star reviews, email them out, and set up recurring review emails.</li>
          <li><B>Activity log:</B> see who changed what, and revert post jobs.</li>
        </UL>
        <H2 id="layout">How the app is laid out</H2>
        <P>The left sidebar is split into four groups.</P>
        <Table
          head={["Group", "Pages"]}
          rows={[
            ["Overview", "Dashboard"],
            ["Manage", "Locations, Posts, Hours, Social"],
            ["Quality", "Suggested Edits, Reviews"],
            ["System", "Activity, Settings, Help & Docs"],
          ]}
        />
        <Callout tone="tip" title="Jump anywhere fast">
          <P>Press <Code>Cmd + K</Code> (or <Code>Ctrl + K</Code>) to focus the "Jump to..." box at the top of the sidebar and type a page name.</P>
        </Callout>
        <H2 id="two-logins">Two separate logins</H2>
        <P>
          This trips people up, so it is worth knowing. There are two different things called "login":
        </P>
        <UL>
          <li><B>Your BizBuddy account.</B> Your name and password. This is what lets you into the app.</li>
          <li><B>The shared Google connection.</B> One agency Google account that BizBuddy uses to talk to Google for all 150+ locations. You do not sign into this yourself day to day.</li>
        </UL>
        <P>
          If the Google connection expires, you can still log in and look around, but anything that talks to Google (posting, hours, syncing) will fail until someone reconnects it.
          See <Link href="/docs/google-connection" className="text-sky-700 underline underline-offset-2">Google connection expired</Link>.
        </P>
      </>
    ),
  },
  {
    slug: "signing-in",
    group: "Get started",
    title: "Signing in and accounts",
    description: "Logging in, creating an account, invite codes and password resets.",
    body: () => (
      <>
        <H2 id="log-in">Log in</H2>
        <Steps>
          <li>On the sign in screen, enter your email and password.</li>
          <li>Click <B>Sign In</B>.</li>
        </Steps>
        <P>Your session lasts 7 days, then you will be asked to sign in again.</P>
        <H2 id="create-account">Create an account</H2>
        <Steps>
          <li>Ask a super admin to generate an invite code for you.</li>
          <li>On the sign in screen click <B>New team member?</B> and enter your name (as the admin added you), your email, a password, and the invite code.</li>
          <li>Click <B>Create Account</B>.</li>
        </Steps>
        <P>Invite codes are single use. The only account that does not need one is the very first one, which becomes the super admin.</P>
        <H2 id="password-rules">Password rules</H2>
        <Callout tone="warn" title="The hint says 6, the real minimum is 10">
          <P>The password field placeholder says "At least 6 characters", but the server requires at least 10 characters and rejects common passwords such as "password" or "bizbuddy". If account creation fails, use a longer, less guessable password.</P>
        </Callout>
        <H2 id="reset">Forgot your password</H2>
        <Steps>
          <li>Click <B>Forgot password?</B> on the sign in screen.</li>
          <li>Enter your email and click <B>Send Reset Link</B>.</li>
          <li>Open the email and use the link within 1 hour.</li>
        </Steps>
        <P>The screen always says "Check your email" whether or not the address exists. That is on purpose.</P>
        <H2 id="lockouts">Too many attempts</H2>
        <P>
          Logins are rate limited. After repeated wrong passwords you will see "Too many login attempts. Try again in N minute(s)." Wait it out, there is no way to skip the timer.
          Password reset requests are limited to 5 per 15 minutes.
        </P>
      </>
    ),
  },
  {
    slug: "roles",
    group: "Get started",
    title: "Roles and permissions",
    description: "What admins and super admins can each do.",
    body: () => (
      <>
        <P>There are two roles. Almost everything is open to both.</P>
        <Table
          head={["Action", "Admin", "Super admin"]}
          rows={[
            ["Posts, hours, social, reviews, suggested edits, activity", "Yes", "Yes"],
            ["Edit settings and review email groups", "Yes", "Yes"],
            ["Reconnect Google", "Yes", "Yes"],
            ["Edit your own profile", "Yes", "Yes"],
            ["Add or remove team members, set roles", "No", "Yes"],
            ["Generate and revoke invite codes", "No", "Yes"],
            ["Disconnect (revoke) Google", "No", "Yes"],
          ]}
        />
        <Callout tone="note">
          <P>The floating avatar in the bottom right shows your name and has <B>Sign Out</B>. Super admins also see a <B>Team</B> button there for managing people.</P>
        </Callout>
      </>
    ),
  },
  {
    slug: "locations",
    group: "Manage locations",
    title: "Locations map and list",
    description: "Find, filter, select and sync your locations.",
    body: () => (
      <>
        <P>The Locations page is the home base for bulk work. Select locations here, then hit an action and BizBuddy opens the right tool already loaded with your selection.</P>
        <H2 id="syncing">Syncing from Google</H2>
        <P>
          Click <B>Sync from Google</B> to pull the latest list of locations and their info. It also runs once automatically the first time you open the page, and every night at 3:00 AM UTC.
          The header shows "Synced 2h ago" or "Last sync failed".
        </P>
        <H2 id="finding">Finding locations</H2>
        <UL>
          <li>Search by name, city or address.</li>
          <li>Filter by <B>Folder</B> (including Hidden) or <B>Tag</B>, or use <B>Exclude Tag</B> to remove some.</li>
          <li>Use the <B>Columns</B> menu to change what the list shows.</li>
          <li><B>Export CSV</B> downloads the current view.</li>
        </UL>
        <H2 id="pin-status">Pin colors and statuses</H2>
        <Table
          head={["Status", "Meaning"]}
          rows={[
            ["Verified", "Healthy and live on Google."],
            ["Edit pending", "Google has a suggested change waiting. Check Suggested Edits."],
            ["Needs re-auth", "The Google connection needs reconnecting."],
            ["Suspended / closed", "Google reports the account or location as suspended or closed."],
            ["Temp closed", "Marked temporarily closed on Google."],
          ]}
        />
        <H2 id="bulk">Bulk actions</H2>
        <Steps>
          <li>Select pins on the map or rows in the list. <B>Select all</B> picks everything in the current filter.</li>
          <li>In the selection card, choose <B>Update hours</B>, <B>Create post</B>, <B>Upload photo</B>, <B>Add to folder</B>, <B>Add tag</B>, or <B>Remove from folder</B> (only when filtered to a folder).</li>
          <li><B>Fit to selection</B> zooms the map to your picks. <B>Clear</B> deselects everything.</li>
        </Steps>
        <H2 id="single">One location</H2>
        <P>Click a pin, then <B>Open detail</B> for performance numbers (7 days up to 1 year, longer ranges unlock as data builds up) and to edit phone, website and description inline.</P>
        <H3 id="hide">Hiding a location</H3>
        <P>Use hide on the selection card for locations you do not manage. Hidden locations are skipped by Suggested Edits scans. Find them again under the <B>Hidden</B> folder filter, select one, and unhide it from the selection card.</P>
      </>
    ),
  },
  {
    slug: "folders-tags",
    group: "Manage locations",
    title: "Folders and tags",
    description: "Organize locations so bulk actions are quick to target.",
    body: () => (
      <>
        <P>Folders and tags are how you target groups of locations in Posts, Hours, Social and Reviews.</P>
        <Table
          head={["", "Folders", "Tags"]}
          rows={[
            ["Use for", "Groups like a region or franchise brand", "Cross cutting labels like 'Open 24h'"],
            ["Fields", "Name (required), description, color", "Name, color"],
            ["Manage from", "Locations > Folders", "Locations > Tags"],
          ]}
        />
        <H2 id="add">Adding locations</H2>
        <Steps>
          <li>Select locations on the Locations page.</li>
          <li>Click <B>Add to folder</B> or <B>Add tag</B>.</li>
          <li>Tick the folders or tags. Tag boxes have three states: all selected locations have it, some do, none do.</li>
          <li>Confirm. If a location was already in a folder you may see "Partial Success", which is harmless.</li>
        </Steps>
        <H2 id="delete">Deleting</H2>
        <UL>
          <li>Deleting a folder does not delete the locations, only the folder.</li>
          <li>Deleting a tag removes it from every location that had it.</li>
        </UL>
      </>
    ),
  },
  {
    slug: "edit-location",
    group: "Manage locations",
    title: "Editing location details",
    description: "Change phone, website and description and push to Google.",
    body: () => (
      <>
        <P>You can edit three fields straight from BizBuddy: <B>Phone Number</B>, <B>Website</B> and <B>Description</B>.</P>
        <Steps>
          <li>Open a location's detail view (or use the edit button on the selection card).</li>
          <li>Hover a field and click to edit.</li>
          <li>Save. You should see "Change pushed to Google Business Profile."</li>
        </Steps>
        <Callout tone="warn" title="Edits go live on Google">
          <P>Saving pushes straight to Google. There is no draft state. If you see "Save failed", check the Google connection banner first.</P>
        </Callout>
        <P>Name, address and categories are not editable here. Use Suggested Edits to handle changes Google proposes, and change those fields in Google Business Profile itself.</P>
      </>
    ),
  },
];
