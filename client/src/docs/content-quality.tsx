import type { Article } from "./types";
import { H2, H3, P, UL, Steps, B, Code, Callout, Table } from "./parts";

export const qualityArticles: Article[] = [
  {
    slug: "suggested-edits",
    group: "Quality and monitoring",
    title: "Suggested Edits",
    description: "Scan for Google suggested changes, then accept or reject them.",
    body: () => (
      <>
        <P>Google (and the public) can suggest changes to a listing. Suggested Edits finds them across your locations so you can review them in one place.</P>
        <H2 id="scan">Run a scan</H2>
        <Steps>
          <li>Open <B>Suggested Edits</B>.</li>
          <li>Click <B>Scan All Locations</B>, or use <B>Filter locations</B> to pick a folder or specific locations and click <B>Scan Selected</B>.</li>
        </Steps>
        <UL>
          <li>The scan runs on the server. You can leave the page or close the browser.</li>
          <li>Only one scan runs at a time. Starting another attaches you to the running one.</li>
          <li>Hidden locations are skipped.</li>
          <li>A small progress pill appears bottom right on other pages. Click <B>View</B> to jump back or <B>Stop scan</B> to cancel. Results found before stopping are kept.</li>
          <li>A scan with no heartbeat for 8 minutes is marked "interrupted", usually because of a deploy. Just run it again.</li>
        </UL>
        <H2 id="review">Review results</H2>
        <P>Results are grouped by category: Business Name, Business Hours, Phone, Address, Categories, Website, Description and more. Each field opens a compare dialog showing your current value next to Google's.</P>
        <UL>
          <li><B>Accept</B> makes Google's version live on Maps and Search.</li>
          <li><B>Reject</B> keeps your current information.</li>
          <li><B>Accept all in category</B> handles a whole group. Expect "Partial Success" if a few fail.</li>
        </UL>
        <H2 id="history">History and undo</H2>
        <P>Decisions are kept (last 200, 10 shown at a time). <B>Undo</B> pushes the previous values back to Google, and you can redo it.</P>
        <Callout tone="tip" title="When a scan says it finished with errors">
          <P>"Couldn't be checked" locations usually hit a Google rate limit or an expired connection. Check for the amber reconnect banner, then rescan.</P>
        </Callout>
      </>
    ),
  },
  {
    slug: "reviews",
    group: "Quality and monitoring",
    title: "Reviews",
    description: "Pull low star reviews and email them to a client or team.",
    body: () => (
      <>
        <Steps>
          <li>Open <B>Reviews</B> and pick the client account, folder and locations.</li>
          <li>Set the <B>Star Rating</B> range (default 1 to 3 stars).</li>
          <li>Optionally set a date range.</li>
          <li>Click <B>Fetch Reviews (N location(s))</B>.</li>
          <li>Review the results, then click <B>Email</B> to send a report. Add recipients (comma separated), optional CC and a message.</li>
        </Steps>
        <Callout tone="warn" title="Fetching updates stored ratings">
          <P>Fetching reviews overwrites a location's saved average rating and review count using only the reviews you fetched. If you filter to 1 to 3 stars, those saved numbers reflect that filter.</P>
        </Callout>
        <P>Locations are fetched one by one, so large selections take a minute. If some locations error, you still get results for the rest with a "fetched with some errors" notice.</P>
      </>
    ),
  },
  {
    slug: "review-emails",
    group: "Quality and monitoring",
    title: "Scheduled review emails",
    description: "Set up recurring review reports in Settings.",
    body: () => (
      <>
        <P>Email groups send recurring review summaries without anyone opening Reviews. Find them in <B>Settings &gt; General &gt; Weekly Review Email Groups</B>.</P>
        <H2 id="setup">Create a group</H2>
        <Steps>
          <li>Enter a <B>Group Name</B> and <B>Recipient Emails</B> (both required). CC is optional.</li>
          <li>Pick the <B>Time</B> and <B>Start Date</B>. The first email goes out on the start date at that time, then repeats.</li>
          <li>Choose a frequency: every week, every other week, or once a month.</li>
          <li>Set the star filter (min and max, 1 to 5).</li>
          <li>Set the review period: last N days, or last month (calendar). Last month forces monthly frequency.</li>
          <li>Choose locations by folder or one by one.</li>
          <li>Pick the delivery format: email, or spreadsheet.</li>
          <li>Save, then use <B>Test</B> to send a sample to yourself. Tests are not logged.</li>
        </Steps>
        <H2 id="timing">Timing rules</H2>
        <UL>
          <li>All send times are Phoenix time (no daylight saving).</li>
          <li>The review window ends at midnight Phoenix today and excludes today.</li>
          <li>Monthly sends are clamped to the month length, so a start on the 31st still sends in shorter months.</li>
        </UL>
        <Callout tone="tip" title="Use the 1st for calendar months">
          <P>With "Last month (calendar)", set the start date to the 1st through 3rd. Start on the 28th and each recap arrives 27 days after the month ends.</P>
        </Callout>
        <H2 id="spreadsheet">Spreadsheet format</H2>
        <P>Spreadsheet groups can break the data into tabs by region, by location, or not at all, and can tag reviews with themes you list (comma separated). If a spreadsheet group has no reviews in the window it is skipped. Email format groups still send a "No New Reviews" note.</P>
        <H2 id="retries">If a send fails</H2>
        <P>BizBuddy retries with growing waits (10 minutes, then 20, up to 60) for up to 10 attempts, then gives up on that send. The Dashboard "Upcoming activity" card shows the next send per group.</P>
      </>
    ),
  },
  {
    slug: "dashboard",
    group: "Quality and monitoring",
    title: "Dashboard",
    description: "Reading the KPIs and the Needs your attention list.",
    body: () => (
      <>
        <P>The Dashboard is your morning check. Pick a period (7, 30 or 90 days) and a client at the top.</P>
        <H2 id="kpis">KPI cards</H2>
        <P>Locations, Calls, Clicks, Profile Views and Average Rating. The note under them says "Google data through [date]". Performance data syncs nightly and Google itself lags 2 to 3 days, so today's numbers will not be there yet.</P>
        <H2 id="attention">Needs your attention</H2>
        <UL>
          <li><B>Failed jobs</B> (click Fix) and <B>partial jobs</B> (click Review).</li>
          <li><B>Unauthorized edit</B> on a location, meaning info changed on Google that you did not make.</li>
          <li><B>Locations with missing info</B> (no address or phone).</li>
        </UL>
        <P>Each item can be dismissed. <B>View all</B> goes to the Activity log.</P>
        <H2 id="actions">Quick actions</H2>
        <P>Create post, Update hours, Social links and Edit info are shortcuts to the same tools described in this guide. Retry on a failed post job pre-fills the Posts form so you can review and publish again.</P>
        <Callout tone="warn" title="Undo This Job">
          <P>The Undo This Job button on the Dashboard may fail with "Failed to undo". If it does, revert from the Activity log instead.</P>
        </Callout>
      </>
    ),
  },
  {
    slug: "activity-log",
    group: "Quality and monitoring",
    title: "Activity log",
    description: "Audit trail of every change and how reverting works.",
    body: () => (
      <>
        <P>The Activity page records who did what and when, grouped by day.</P>
        <UL>
          <li>Filter by period, person, location, or tab (All, Posts, Profile, Reviews, System).</li>
          <li>Search by user or location.</li>
          <li><B>Export CSV</B> for reporting.</li>
          <li>"System" rows are the automatic nightly sync.</li>
        </UL>
        <H2 id="revert">Reverting</H2>
        <Steps>
          <li>Tick the rows you want to undo.</li>
          <li>Click <B>Revert</B> and confirm. The log entries stay, for your records.</li>
        </Steps>
        <Table
          head={["Job type", "What revert really does"]}
          rows={[
            ["Post", "Deletes the post from Google."],
            ["Hours", "Nothing on Google. Hours changes cannot be reverted automatically. Re-run an update with the old hours."],
            ["Photos", "Nothing on Google. Photos cannot be removed automatically."],
          ]}
        />
        <Callout tone="warn">
          <P>The confirmation dialog does not tell you that hours and photo jobs are not truly reverted, so do not rely on it for those.</P>
        </Callout>
      </>
    ),
  },
  {
    slug: "automations",
    group: "Quality and monitoring",
    title: "What runs automatically",
    description: "Nightly syncs and schedulers, with times.",
    body: () => (
      <>
        <P>These run without anyone clicking anything. Times below are UTC. Phoenix is UTC minus 7.</P>
        <Table
          head={["When", "What", "Notes"]}
          rows={[
            ["Every minute", "Scheduled posts", "Publishes anything whose date and time is due."],
            ["Every minute", "Review emails", "Sends due groups, retries failures."],
            ["3:00 AM daily", "Location sync from Google", "Logged as System. Also checks social link drift and geocodes addresses."],
            ["4:00 AM daily", "Performance data", "Pulls 90 days per location for the Dashboard."],
          ]}
        />
        <P>The Settings page shows Last Synced and Next Sync for locations.</P>
      </>
    ),
  },
];
