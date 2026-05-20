import Papa from 'papaparse';
import { promises as fs } from 'fs';
import path from 'path';

const CSV_PATH = path.join(process.cwd(), 'data', 'verification-baseline.csv');

export interface LocationBaseline {
  location: string;
  phone: string;
  address: string;
  website: string;
  hours: string;
  rating: string;
  reviewCount: number;
  starRating: number;
}

// Parse "4.0 Stars, 450 Reviews" format
function parseRatingString(ratingStr: string): { stars: number; reviews: number } {
  const match = ratingStr.match(/([\d.]+)\s*Stars?,\s*(\d+)\s*Reviews?/i);
  if (match) {
    return {
      stars: parseFloat(match[1]),
      reviews: parseInt(match[2], 10)
    };
  }
  return { stars: 0, reviews: 0 };
}

// Normalize address for comparison (remove extra spaces, punctuation, make lowercase)
export function normalizeAddress(address: string): string {
  return address
    .toLowerCase()
    .replace(/[,\.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract multiple phone numbers from string
export function extractPhoneNumbers(phoneStr: string): string[] {
  // Remove common labels like "Primary", "Secondary", "-", parentheses
  const cleaned = phoneStr.replace(/primary|secondary|-|[()]/gi, '');

  // Match phone patterns: (123) 456-7890 or 123-456-7890
  const phoneRegex = /\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const matches = cleaned.match(phoneRegex) || [];

  // Normalize to digits only
  return matches.map(p => p.replace(/\D/g, ''));
}

export async function parseCSV(): Promise<Map<string, LocationBaseline>> {
  try {
    const csvContent = await fs.readFile(CSV_PATH, 'utf-8');

    const result = Papa.parse<any>(csvContent, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
      transformHeader: (header) => header.trim()
    });

    const locationMap = new Map<string, LocationBaseline>();

    result.data.forEach((row) => {
      // Skip empty rows
      if (!row.Location || !row.Address) return;

      const { stars, reviews } = parseRatingString(row['Rating & Reviews '] || row['Rating & Reviews'] || '');

      const baseline: LocationBaseline = {
        location: row.Location.trim(),
        phone: row.Phone ? row.Phone.trim() : '',
        address: row.Address.trim(),
        website: row.Website ? row.Website.trim() : '',
        hours: row['Hours\nConfirm these are still the most current hours by referencing their website.'] || 
               row.Hours || '',
        rating: row['Rating & Reviews '] || row['Rating & Reviews'] || '',
        starRating: stars,
        reviewCount: reviews
      };

      // Use normalized address as key for lookup
      const normalizedAddr = normalizeAddress(baseline.address);
      locationMap.set(normalizedAddr, baseline);
    });

    return locationMap;
  } catch (error) {
    console.error('CSV parsing error:', error);
    throw new Error('Failed to parse CSV file');
  }
}