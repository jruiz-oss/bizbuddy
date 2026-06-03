export function generateStarsHtml(rating: number): string {
  return Array.from({ length: 5 }, (_, i) =>
    i < rating
      ? '<span style="color: #facc15; font-size: 18px;">★</span>'
      : '<span style="color: #d1d5db; font-size: 18px;">★</span>'
  ).join('');
}

export function generateLocationCopyText(locationName: string, address: string | undefined, reviews: any[]): string {
  const starsFilled = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
  const blocks: string[] = [];
  blocks.push(`📍 ${locationName}`);
  if (address) blocks.push(address);
  reviews.forEach((r, idx) => {
    const date = new Date(r.createTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    blocks.push(starsFilled(r.starRating));
    blocks.push(`${r.reviewer} — ${date}`);
    blocks.push(r.comment ? `"${r.comment}"` : '(No comment)');
    if (idx < reviews.length - 1) blocks.push('---');
  });
  return blocks.join('\r\n\r\n').trim();
}

export function generateLocationMailtoHref(locationName: string, address: string | undefined, reviews: any[]): string {
  const MAX_ENCODED_LEN = 1800;
  const subject = `Reviews for ${locationName}`;
  const fullBody = generateLocationCopyText(locationName, address, reviews);
  let body = fullBody;
  if (encodeURIComponent(body).length > MAX_ENCODED_LEN) {
    const suffix = '\n\n...see the original email for the full list.';
    let lo = 0, hi = body.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (encodeURIComponent(body.slice(0, mid) + suffix).length <= MAX_ENCODED_LEN) lo = mid;
      else hi = mid - 1;
    }
    body = body.slice(0, lo).replace(/\s+\S*$/, '') + suffix;
  }
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function generateLocationCopyHtml(locationName: string, address: string | undefined, reviews: any[]): string {
  const starsHtml = (n: number) =>
    '★'.repeat(n) + '<span style="color:#d1d5db;">★</span>'.repeat(5 - n);
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let html = `<div style="font-family:Arial,sans-serif;max-width:600px;">`;
  html += `<div style="background:#f3f4f6;border-radius:8px;padding:12px 16px;margin-bottom:12px;">`;
  html += `<strong style="font-size:15px;color:#374151;">📍 ${esc(locationName)}</strong>`;
  if (address) html += `<div style="font-size:13px;color:#6b7280;margin-top:2px;">${esc(address)}</div>`;
  html += `</div>`;
  for (const r of reviews) {
    const date = new Date(r.createTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    html += `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:10px;background:#fff;">`;
    html += `<div style="margin-bottom:8px;"><strong style="font-size:15px;color:#1f2937;">${esc(r.reviewer)}</strong>`;
    html += `<div style="margin-top:3px;"><span style="color:#facc15;font-size:17px;">${starsHtml(r.starRating)}</span> <span style="color:#6b7280;font-size:13px;margin-left:6px;">${date}</span></div></div>`;
    if (r.comment) html += `<p style="color:#374151;margin:0;line-height:1.6;font-style:italic;">"${esc(r.comment)}"</p>`;
    else html += `<p style="color:#9ca3af;margin:0;font-style:italic;">No comment provided</p>`;
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

function generateThemeSummaryHtml(reviews: any[]): string {
  // Aggregate pos/neg counts per theme across all reviews
  const stats: Record<string, { pos: number; neg: number }> = {};
  for (const r of reviews) {
    if (!r.themes || r.themes.length === 0) continue;
    const isPos = r.starRating >= 4;
    const isNeg = r.starRating <= 2;
    for (const theme of r.themes) {
      if (!stats[theme]) stats[theme] = { pos: 0, neg: 0 };
      if (isPos) stats[theme].pos++;
      if (isNeg) stats[theme].neg++;
    }
  }

  const entries = Object.entries(stats)
    .sort((a, b) => (b[1].pos + b[1].neg) - (a[1].pos + a[1].neg))
    .slice(0, 8);

  if (entries.length === 0) return '';

  const rows = entries.map(([theme, s]) => {
    const total = s.pos + s.neg;
    const posPct = total > 0 ? Math.round((s.pos / total) * 100) : 0;
    const negPct = 100 - posPct;
    const label = theme.startsWith('* ') ? theme.slice(2) : theme;
    const isDiscovered = theme.startsWith('* ');

    return `
      <tr>
        <td style="padding: 6px 12px 6px 0; white-space: nowrap; color: #374151; font-size: 13px; font-weight: ${isDiscovered ? 'normal' : '600'}; width: 130px; vertical-align: middle;">
          ${label}${isDiscovered ? ' <span style="color:#9ca3af;font-size:11px;">(AI)</span>' : ''}
        </td>
        <td style="padding: 6px 0; vertical-align: middle;">
          <div style="display: flex; border-radius: 4px; overflow: hidden; height: 18px; background: #f3f4f6; min-width: 200px;">
            ${posPct > 0 ? `<div style="width: ${posPct}%; background: #16a34a; height: 100%;"></div>` : ''}
            ${negPct > 0 ? `<div style="width: ${negPct}%; background: #dc2626; height: 100%;"></div>` : ''}
          </div>
        </td>
        <td style="padding: 6px 0 6px 10px; white-space: nowrap; font-size: 12px; color: #6b7280; vertical-align: middle;">
          <span style="color: #16a34a; font-weight: 600;">${s.pos}+</span>
          <span style="color: #9ca3af; margin: 0 2px;">/</span>
          <span style="color: #dc2626; font-weight: 600;">${s.neg}−</span>
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="margin-bottom: 28px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 18px 20px; background: #fafafa;">
      <div style="font-size: 13px; font-weight: 700; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 14px;">
        Top Themes
      </div>
      <table cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
    </div>`;
}

export function generateReviewEmailHtml(
  reviews: any[],
  clientName: string,
  minStars: number,
  maxStars: number,
  dateRangeText: string,
  allCheckedLocations?: { name: string; address?: string; reviewCount: number }[],
  customMessage?: string,
  appBaseUrl?: string
): string {
  const reviewsByLocation = reviews.reduce((acc, review) => {
    const key = review.gbpLocationId || review.locationName || 'Unknown Location';
    if (!acc[key]) {
      acc[key] = { reviews: [], name: review.locationName, address: review.locationAddress };
    }
    acc[key].reviews.push(review);
    return acc;
  }, {} as Record<string, { reviews: any[]; name?: string; address?: string }>);

  const starText = minStars === maxStars
    ? `${minStars} star${minStars !== 1 ? 's' : ''}`
    : `${minStars}-${maxStars} stars`;

  const locationsWithZero = allCheckedLocations?.filter(l => l.reviewCount === 0) || [];

  const titleText = reviews.length > 0
    ? `${reviews.length} Review${reviews.length !== 1 ? 's' : ''} — ${starText}`
    : `Review Summary — ${starText}`;

  let html = `
    <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px;">
      ${customMessage ? `
      <div style="margin-bottom: 28px;">
        ${customMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;').split(/\r?\n/).filter((line: string) => line.trim() !== '').map((line: string) => `<p style="color: #1f2937; margin: 0 0 10px 0; line-height: 1.7; font-size: 15px;">${line}</p>`).join('')}
      </div>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin-bottom: 24px;" />` : ''}
      <div style="color: #1f2937; font-size: 22px; font-weight: bold; border-bottom: 2px solid #e5e7eb; padding-bottom: 10px; margin-bottom: 16px; line-height: 1.3;">
        ${titleText}
      </div>
      <p style="color: #6b7280; margin-bottom: 20px;">
        ${dateRangeText}
      </p>
      ${generateThemeSummaryHtml(reviews)}
  `;

  for (const [_key, data] of Object.entries(reviewsByLocation) as [string, { reviews: any[]; name?: string; address?: string }][]) {
    let copyLinkHtml = '';
    if (appBaseUrl && data.reviews.length > 0) {
      const copyText = generateLocationCopyText(data.name || 'Unknown Location', data.address, data.reviews);
      const copyHtml = generateLocationCopyHtml(data.name || 'Unknown Location', data.address, data.reviews);
      const encodedData = Buffer.from(copyText, 'utf8').toString('base64url');
      const encodedHtml = Buffer.from(copyHtml, 'utf8').toString('base64url');
      const copyUrl = `${appBaseUrl}/api/copy-review?data=${encodedData}&html=${encodedHtml}`;
      const mailtoHref = generateLocationMailtoHref(data.name || 'Unknown Location', data.address, data.reviews);
      const btnStyle = 'display:inline-block;background:#001f3f;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:8px 16px;border-radius:6px;margin:0 8px 6px 0;line-height:1;mso-padding-alt:0;';
      copyLinkHtml = `
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px 0;border-collapse:collapse;">
          <tr>
            <td style="padding:0 8px 0 0;">
              <a href="${copyUrl}" target="_blank" style="${btnStyle}">Copy</a>
            </td>
            <td style="padding:0;">
              <a href="${mailtoHref}" style="${btnStyle}">Email</a>
            </td>
          </tr>
        </table>`;
    }

    html += `
      <div style="margin-bottom: 30px; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px;">
        <div style="background: #f3f4f6; padding: 12px 16px; border-radius: 8px; margin: 0 0 15px 0;">
          <div style="color: #374151; font-size: 16px; font-weight: bold; line-height: 1.3;">📍 ${data.name || 'Unknown Location'}</div>
          ${data.address ? `<div style="font-size: 14px; color: #6b7280; margin-top: 4px;">${data.address}</div>` : ''}
        </div>
        ${copyLinkHtml}
    `;

    for (const review of data.reviews) {
      html += `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 12px; background: #fff;">
          <div style="margin-bottom: 10px;">
            <strong style="color: #1f2937; font-size: 16px;">${review.reviewer}</strong>
            <div style="margin-top: 4px;">
              ${generateStarsHtml(review.starRating)}
              <span style="color: #6b7280; font-size: 14px; margin-left: 8px;">
                ${new Date(review.createTime).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          </div>
          ${review.comment
            ? `<p style="color: #374151; margin: 0; line-height: 1.6; font-style: italic;">"${review.comment}"</p>`
            : `<p style="color: #9ca3af; margin: 0; font-style: italic;">No comment provided</p>`
          }
        </div>
      `;
    }

    html += `</div>`;
  }

  for (const loc of locationsWithZero) {
    html += `
      <div style="margin-bottom: 30px; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px;">
        <div style="color: #374151; font-size: 16px; font-weight: bold; line-height: 1.3; background: #f3f4f6; padding: 12px 16px; border-radius: 8px; margin: 0 0 15px 0;">
          📍 ${loc.name || 'Unknown Location'}
          ${loc.address ? `<span style="font-size: 14px; font-weight: normal; color: #6b7280; display: block;">${loc.address}</span>` : ''}
        </div>
        <p style="color: #9ca3af; margin: 0; font-size: 14px; font-style: italic;">No new reviews this period.</p>
      </div>
    `;
  }

  html += `
      <div style="margin-top: 36px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: left;">
        <img src="cid:commit-logo" alt="Commit Agency" style="height: 48px; width: auto;" />
      </div>
    </div>
  `;

  return html;
}
