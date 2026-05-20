import { Router, Request } from 'express';
import multer from 'multer';
import { promises as fs } from 'fs';
import path from 'path';
import { verifyLocations } from './services/gbpVerification';

const router = Router();

// Store CSV in memory temporarily, then save to disk
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

const CSV_PATH = path.join(process.cwd(), 'data', 'verification-baseline.csv');

// Ensure data directory exists
async function ensureDataDir() {
  const dir = path.dirname(CSV_PATH);
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

// Interface for authenticated requests
interface AuthenticatedRequest extends Request {
  oauth2Client?: any;
  user?: any;
}

// Upload new CSV (replaces existing)
router.post('/upload-csv', upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await ensureDataDir();
    await fs.writeFile(CSV_PATH, req.file.buffer);

    res.json({ 
      message: 'CSV uploaded successfully',
      filename: req.file.originalname,
      size: req.file.size
    });
  } catch (error) {
    console.error('CSV upload error:', error);
    res.status(500).json({ error: 'Failed to upload CSV' });
  }
});

// Get current CSV status
router.get('/csv-status', async (req, res) => {
  try {
    await ensureDataDir();

    try {
      const stats = await fs.stat(CSV_PATH);
      res.json({
        exists: true,
        uploadedAt: stats.mtime,
        size: stats.size
      });
    } catch {
      res.json({ exists: false });
    }
  } catch (error) {
    console.error('CSV status error:', error);
    res.status(500).json({ error: 'Failed to check CSV status' });
  }
});

// Verify all locations
router.get('/verify-all', async (req: AuthenticatedRequest, res) => {
  try {
    // Get access token the same way your google-service-auth.ts does
    const oauth2Client = req.oauth2Client;

    if (!oauth2Client) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Get the access token
    const { token } = await oauth2Client.getAccessToken();

    if (!token) {
      return res.status(401).json({ error: 'Failed to get access token' });
    }

    const results = await verifyLocations(token);
    res.json(results);
  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ 
      error: 'Failed to verify locations',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
