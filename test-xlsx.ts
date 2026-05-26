import { generateReviewsXlsx } from './server/utils/review-xlsx-generator';

async function main() {
  const testReviews = [
    { locationName: 'Pita Jungle Scottsdale', locationAddress: '1234 Scottsdale Rd, Scottsdale, AZ 85251', starRating: 1, reviewer: 'John D.', reviewDate: '2026-05-20T10:00:00Z', reviewText: 'Terrible service, food was cold.', responseAuthor: 'Manager', responseDate: '2026-05-21T09:00:00Z', responseText: 'We are so sorry to hear this.' },
    { locationName: 'Pita Jungle Baltimore', locationAddress: '999 Harbor Dr, Baltimore, MD 21201', starRating: 1, reviewer: 'Bob K.', reviewDate: '2026-05-18T12:00:00Z', reviewText: 'Wrong order twice.' },
    { locationName: 'Pita Jungle SF', locationAddress: '111 Market St, San Francisco, CA 94105', starRating: 3, reviewer: 'Alice M.', reviewDate: '2026-05-17T16:00:00Z', reviewText: 'Mediocre at best.', responseAuthor: 'Team SF', responseDate: '2026-05-18T10:00:00Z', responseText: 'Thank you for the feedback.' },
  ];
  const buf = await generateReviewsXlsx(testReviews, 'region', 'Test Group', 'May 13 – May 20, 2026');
  console.log('✅ xlsx generated, size:', buf.length, 'bytes');
}
main().catch(e => { console.error(e); process.exit(1); });
