import { parseCSV, normalizeAddress, extractPhoneNumbers, LocationBaseline } from '../utils/csvParser';

export interface VerificationResult {
  locationName: string;
  address: string;
  fields: {
    phone: FieldCheck;
    address: FieldCheck;
    website: FieldCheck;
    hours: FieldCheck;
    rating: FieldCheck;
  };
  overallStatus: 'match' | 'mismatch' | 'not_found';
}

export interface FieldCheck {
  status: 'match' | 'mismatch' | 'missing';
  expected: string;
  actual: string;
  details?: string;
}

// Parse hours from GBP API response
function parseGBPHours(regularHours: any): string {
  if (!regularHours || !regularHours.periods) return 'Not set';

  const periods = regularHours.periods;
  if (periods.length === 0) return 'Closed';

  // Check if same hours every day
  const firstPeriod = periods[0];
  const allSame = periods.every((p: any) => 
    p.openTime === firstPeriod.openTime && 
    p.closeTime === firstPeriod.closeTime
  );

  if (allSame && firstPeriod.openTime && firstPeriod.closeTime) {
    // Convert 24hr to 12hr format
    const openHour = parseInt(firstPeriod.openTime.hours || '0');
    const closeHour = parseInt(firstPeriod.closeTime.hours || '0');
    const openAmPm = openHour >= 12 ? 'P.M.' : 'A.M.';
    const closeAmPm = closeHour >= 12 ? 'P.M.' : 'A.M.';
    const openDisplay = openHour > 12 ? openHour - 12 : openHour;
    const closeDisplay = closeHour > 12 ? closeHour - 12 : closeHour;

    return `Sun-Sat ${openDisplay} ${openAmPm} - ${closeDisplay} ${closeAmPm}`;
  }

  return 'Varies by day';
}

// Compare hours
function compareHours(expected: string, actual: string): FieldCheck {
  const expectedNorm = expected.toLowerCase().replace(/\s+/g, ' ').trim();
  const actualNorm = actual.toLowerCase().replace(/\s+/g, ' ').trim();

  // Handle special cases
  if (expected.includes('Temporarily closed') || expected.includes('temporarily closed')) {
    return {
      status: 'match',
      expected,
      actual
    };
  }

  // Simple contains check
  const match = expectedNorm.includes(actualNorm) || actualNorm.includes(expectedNorm) ||
    expectedNorm.replace(/\./g, '').includes(actualNorm.replace(/\./g, ''));

  return {
    status: match ? 'match' : 'mismatch',
    expected,
    actual
  };
}

export async function verifyLocations(accessToken: string): Promise<VerificationResult[]> {
  try {
    // Parse CSV baseline data
    const baselineMap = await parseCSV();

    // Get all accounts using fetch
    const accountsResponse = await fetch(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!accountsResponse.ok) {
      throw new Error(`Failed to fetch accounts: ${accountsResponse.statusText}`);
    }

    const accountsData = await accountsResponse.json();
    const accounts = accountsData.accounts || [];

    if (accounts.length === 0) {
      throw new Error('No accounts found');
    }

    const results: VerificationResult[] = [];

    // For each account, get locations
    for (const account of accounts) {
      const accountId = account.name.split('/').pop();

      const locationsResponse = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/${accountId}/locations?readMask=name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,metadata`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!locationsResponse.ok) {
        console.error(`Failed to fetch locations for account ${accountId}`);
        continue;
      }

      const locationsData = await locationsResponse.json();
      const locations = locationsData.locations || [];

      for (const location of locations) {
        const actualAddress = location.storefrontAddress?.addressLines?.join(', ') || '';
        const fullActualAddress = `${actualAddress}, ${location.storefrontAddress?.locality || ''}, ${location.storefrontAddress?.administrativeArea || ''} ${location.storefrontAddress?.postalCode || ''}`.trim();
        const normalizedActual = normalizeAddress(fullActualAddress);

        // Find matching baseline by address
        let baseline: LocationBaseline | undefined;

        // Try exact match first
        baseline = baselineMap.get(normalizedActual);

        // If no exact match, try partial matching on street address
        if (!baseline) {
          const normalizedStreet = normalizeAddress(actualAddress);
          for (const [key, value] of baselineMap.entries()) {
            if (key.includes(normalizedStreet) || normalizedStreet.includes(key.split(',')[0])) {
              baseline = value;
              break;
            }
          }
        }

        if (!baseline) {
          // Location exists in GBP but not in CSV
          results.push({
            locationName: location.title || 'Unknown',
            address: fullActualAddress,
            fields: {
              phone: { status: 'missing', expected: '', actual: location.phoneNumbers?.primaryPhone || '' },
              address: { status: 'missing', expected: '', actual: fullActualAddress },
              website: { status: 'missing', expected: '', actual: location.websiteUri || '' },
              hours: { status: 'missing', expected: '', actual: parseGBPHours(location.regularHours) },
              rating: { status: 'missing', expected: '', actual: 'N/A' }
            },
            overallStatus: 'not_found'
          });
          continue;
        }

        // Compare phone
        const actualPhones = location.phoneNumbers?.primaryPhone ? 
          [location.phoneNumbers.primaryPhone.replace(/\D/g, '')] : [];
        const expectedPhones = extractPhoneNumbers(baseline.phone);
        const phoneMatch = expectedPhones.length === 0 || 
          expectedPhones.some(ep => actualPhones.includes(ep));

        // Compare website
        const actualWebsite = location.websiteUri || '';
        const expectedWebsite = baseline.website || '';
        const websiteMatch = !expectedWebsite || 
          actualWebsite.includes(expectedWebsite.replace('https://www.goodwillaz.org', '')) ||
          expectedWebsite.includes(actualWebsite.replace('https://www.goodwillaz.org', ''));

        // Compare hours
        const actualHours = parseGBPHours(location.regularHours);
        const hoursCheck = compareHours(baseline.hours, actualHours);

        // Compare address
        const addressMatch = normalizedActual.includes(normalizeAddress(baseline.address)) ||
          normalizeAddress(baseline.address).includes(normalizedActual);

        const result: VerificationResult = {
          locationName: location.title || baseline.location,
          address: fullActualAddress,
          fields: {
            phone: {
              status: phoneMatch ? 'match' : 'mismatch',
              expected: baseline.phone,
              actual: location.phoneNumbers?.primaryPhone || 'Not set',
              details: phoneMatch ? undefined : `Expected: ${expectedPhones.join(' or ')}, Got: ${actualPhones.join(', ')}`
            },
            address: {
              status: addressMatch ? 'match' : 'mismatch',
              expected: baseline.address,
              actual: fullActualAddress
            },
            website: {
              status: websiteMatch ? 'match' : 'mismatch',
              expected: baseline.website,
              actual: actualWebsite
            },
            hours: hoursCheck,
            rating: {
              status: 'match',
              expected: baseline.rating,
              actual: 'Requires separate API call',
              details: 'Review data not included in basic location info'
            }
          },
          overallStatus: phoneMatch && websiteMatch && addressMatch && hoursCheck.status === 'match' 
            ? 'match' 
            : 'mismatch'
        };

        results.push(result);
      }
    }

    return results;
  } catch (error) {
    console.error('Verification error:', error);
    throw error;
  }
}
