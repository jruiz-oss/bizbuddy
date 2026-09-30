import type { Article } from "./types";
import { H2, H3, P, UL, Steps, B, Code, Callout, Table } from "./parts";

export const bulkArticles: Article[] = [
  {
    slug: "posts",
    group: "Bulk updates",
    title: "Posts",
    description: "Publish or schedule Google posts to many locations.",
    body: () => (
      <>
        <H2 id="create">Create a post</H2>
        <Steps>
          <li>Go to <B>Posts</B> and click <B>New post</B>.</li>
          <li>Pick targets with the search box and folder or tag chips.</li>
          <li>Write the description (required, 1,500 characters max).</li>
          <li>Optionally add a photo, by upload or by pasting a URL.</li>
          <li>Optionally choose a button type (Learn More, Order, Call, Book, Sign Up). A link is required whenever a button is set.</li>
          <li>Choose <B>Post now</B> or <B>Schedule</B> and set a date and time (default 9:00 AM).</li>
          <li>Click <B>Publish to N location(s)</B> or <B>Schedule for N location(s)</B>. A preview opens first, confirm there.</li>
        </Steps>
        <H2 id="images">Image rules</H2>
        <UL>
          <li>JPG, PNG or GIF only. HEIC and HEIF are rejected.</li>
          <li>Minimum size is 250 by 250 pixels.</li>
          <li>Uploads are capped at 50 MB and 10 files per request.</li>
        </UL>
        <H2 id="utm">UTM tracking</H2>
        <P>The UTM shortcut builds a tagged link with source <Code>local</Code>, medium <Code>gbppost</Code>, and a campaign of today's date as MMDDYYYY. Copy the final link into the button link field yourself and double check it.</P>
        <H2 id="scheduled">Scheduled posts</H2>
        <UL>
          <li>Upcoming scheduled posts are listed on the Posts page and refresh every 30 seconds.</li>
          <li>Open one and choose <B>Cancel Scheduled Post</B> to stop it. This only works while it is still scheduled.</li>
          <li>The scheduler checks every minute, and times are stored in UTC.</li>
        </UL>
        <Callout tone="warn" title="Time zones">
          <P>The scheduled posts list shows Phoenix time (it is labeled). The preview dialog shows your browser's time zone. If you are not in Arizona, check which one you are looking at.</P>
        </Callout>
        <Callout tone="note" title="No recurring posts">
          <P>Only one time scheduled posts exist. There is no "repeat weekly" option yet.</P>
        </Callout>
        <H2 id="delete">Deleting a post</H2>
        <P>Delete in Recent posts removes the post from Google. It cannot be undone.</P>
        <H2 id="pace">How publishing runs</H2>
        <P>
          BizBuddy posts one location at a time, about 3 requests a second, and retries each failed location up to 3 times. A duplicate guard stops a retry from posting twice.
          A big batch takes a while, leave the progress window open. See <B>Jobs and progress</B>.
        </P>
      </>
    ),
  },
  {
    slug: "hours",
    group: "Bulk updates",
    title: "Business hours",
    description: "Regular hours, special hours and holiday updates in bulk.",
    body: () => (
      <>
        <P>The Hours page has two tabs with very different behavior. Read the next box before using either.</P>
        <Callout tone="warn" title="Replace vs merge">
          <P><B>Regular hours replace everything</B> on each selected location. <B>Special hours merge</B> with what is already there, and the same date gets overwritten.</P>
        </Callout>
        <H2 id="regular">Regular hours</H2>
        <Steps>
          <li>Step 1: pick locations. Search, add a folder or tag, or use <B>Select all visible</B>.</li>
          <li>Open the <B>Regular Hours</B> tab.</li>
          <li>Set open and close times per day. Use <B>Mark Closed</B> for days off.</li>
          <li>To copy one day to the rest, click <B>Select</B> on that day then <B>Apply day's hours to all days</B>.</li>
          <li>Click <B>Update Hours for N Location(s)</B>, then <B>Confirm &amp; Update</B>.</li>
        </Steps>
        <P>Only open days are sent, with one open and close pair per day. Split shifts (closing for lunch) are not supported here.</P>
        <H2 id="special">Special hours</H2>
        <Steps>
          <li>Open the <B>Special Hours</B> tab.</li>
          <li>Click <B>Add Special Hours Period</B>. Enter a date and open and close times, or tick closed.</li>
          <li>Add as many dates as you need, then click <B>Update Special Hours for N Location(s)</B>.</li>
        </Steps>
        <Callout tone="tip">
          <P>Always fill in the date before adding more rows. An empty date is not checked on the page and will fail later.</P>
        </Callout>
        <H2 id="history">Recent hours updates</H2>
        <P>Every update is listed with details and which locations failed. Deleting a history row only removes the record. <B>It does not undo the hours on Google.</B> To undo, run a new update with the old hours.</P>
        <H2 id="modal">Quick edit from Locations</H2>
        <P>The Update hours action on the Locations page opens a smaller editor with templates (Restaurant Hours, Retail Store, Professional Services) and a "Copy Monday to Weekdays" shortcut. It uses the same replace behavior.</P>
      </>
    ),
  },
  {
    slug: "social",
    group: "Bulk updates",
    title: "Social links",
    description: "Set social profile links across locations.",
    body: () => (
      <>
        <P>Supported platforms: X (Twitter), Facebook, Instagram, YouTube, LinkedIn, TikTok and Pinterest.</P>
        <Steps>
          <li>Open <B>Social</B> and pick locations.</li>
          <li>Fill in the URLs you want to set.</li>
          <li>Click <B>Confirm Update</B>.</li>
        </Steps>
        <H2 id="rules">Things to know</H2>
        <UL>
          <li><B>Blank fields are ignored.</B> You cannot remove a link by leaving it empty.</li>
          <li>URLs are not validated. Paste the full link and test it.</li>
          <li>BizBuddy saves locally first, then pushes to Google. If Google rejects some locations you will see "Partial Sync to Google" with the count. Some location types do not accept every platform.</li>
        </UL>
        <P>The Dashboard also flags when a location's social links drift from what you saved, using the nightly sync.</P>
      </>
    ),
  },
  {
    slug: "photos",
    group: "Bulk updates",
    title: "Photo upload",
    description: "Uploading photos to many locations.",
    body: () => (
      <>
        <Callout tone="warn" title="Verify on Google before you rely on this">
          <P>Photo jobs can report success even when nothing reached Google. After any bulk photo upload, open a couple of profiles on Google and confirm the photos are there. Treat it as unreliable until this is fixed.</P>
        </Callout>
        <H2 id="flow">Flow</H2>
        <Steps>
          <li>Select locations on the Locations page and click <B>Upload photo</B>.</li>
          <li>Drag photos in, or click <B>Choose Photos</B>. Images only, 10 MB each. Duplicates by name and size are skipped.</li>
          <li>Set a category per photo: Exterior, Interior, Products/Services, Team, Food &amp; Drinks, Menu, Equipment or Other.</li>
          <li>Click <B>Upload N Photo(s) to M Location(s)</B>.</li>
        </Steps>
      </>
    ),
  },
  {
    slug: "jobs-progress",
    group: "Bulk updates",
    title: "Jobs and progress",
    description: "What the progress window means and what partial results are.",
    body: () => (
      <>
        <P>Posts, hours and photo uploads run as jobs. A progress window opens when you start one.</P>
        <UL>
          <li>It shows "N of M locations" and three steps: Queued, Processing, Finalizing.</li>
          <li>Keep the window open. "Please wait, do not close this window."</li>
          <li>Locations run one at a time at about 3 requests a second, with 3 retries each (after 2, 4 and 8 seconds).</li>
        </UL>
        <H2 id="outcomes">Outcomes</H2>
        <Table
          head={["Result", "Meaning", "What to do"]}
          rows={[
            ["All Done!", "Every location succeeded.", "Nothing."],
            ["Completed with Errors", "Some locations worked, some did not (partial).", "Open the error details, fix the cause, rerun for the failed ones. Use View Failed."],
            ["Job Failed", "No location succeeded.", "Check the Google connection, then retry."],
          ]}
        />
        <P>The "Error details" box shows the first failure. The full list per location is in the Activity log.</P>
      </>
    ),
  },
  {
    slug: "apple-maps",
    group: "Bulk updates",
    title: "Apple Maps",
    description: "The Apple listing tracker and export.",
    body: () => (
      <>
        <Callout tone="note" title="No live Apple connection">
          <P>The Apple Maps page is a place to store listing data inside BizBuddy. It does not push anything to Apple. You copy the data out and paste it into Apple Business Connect yourself.</P>
        </Callout>
        <UL>
          <li>Reach it with the platform switch ("Switch to Apple" and "Switch to Google").</li>
          <li><B>Add Location</B> stores a name, address, phone, website, description and hours.</li>
          <li><B>Bulk Edit Hours</B> updates hours for selected listings.</li>
          <li><B>Export for Apple</B> gives copy buttons for each field, or <B>Copy All</B>.</li>
        </UL>
        <P>The platform choice is not remembered. After a refresh you are back on Google.</P>
      </>
    ),
  },
];
