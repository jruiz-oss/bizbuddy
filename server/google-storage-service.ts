import { Storage } from '@google-cloud/storage';

class GoogleStorageService {
  private bucketName = 'gbp_images';
  private projectId: string | null = null;

  constructor() {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
    
    if (!projectId) {
      console.warn('⚠️ GOOGLE_CLOUD_PROJECT_ID not set. Photo uploads will not work.');
      return;
    }

    this.projectId = projectId;
    console.log('✅ Google Cloud Storage initialized');
  }

  private async getStorageClient(): Promise<Storage> {
    const { googleOAuthAuth } = await import('./google-service-auth.js');
    
    if (!googleOAuthAuth.isAuthenticated()) {
      throw new Error('User not authenticated. Cannot access Google Cloud Storage.');
    }

    const oauth2Client = (googleOAuthAuth as any).oauth2Client;
    
    const storage = new Storage({
      projectId: this.projectId!,
      authClient: oauth2Client,
    });

    return storage;
  }

  async uploadImage(fileBuffer: Buffer, fileName: string, mimeType: string, folder?: string): Promise<string> {
    if (!this.projectId) {
      throw new Error('Google Cloud Storage not configured');
    }

    try {
      const storage = await this.getStorageClient();
      const bucket = storage.bucket(this.bucketName);

      // Slugify to safe ASCII so the public URL has no spaces/special chars.
      // GMB's image fetcher fails on %-encoded spaces and punctuation, so we
      // strip them entirely rather than rely on URL encoding.
      const slugify = (input: string): string =>
        input
          .normalize('NFKD')
          .replace(/[̀-ͯ]/g, '')   // drop accents
          .toLowerCase()
          .replace(/[^a-z0-9.]+/g, '-')      // anything unsafe -> hyphen (keep dots for ext)
          .replace(/-+/g, '-')               // collapse repeats
          .replace(/^-+|-+$/g, '');          // trim leading/trailing

      // Split extension off so the dot before it survives slugify cleanly.
      const dotIdx = fileName.lastIndexOf('.');
      const base = dotIdx > 0 ? fileName.slice(0, dotIdx) : fileName;
      const ext = dotIdx > 0 ? fileName.slice(dotIdx + 1).replace(/[^a-z0-9]/gi, '').toLowerCase() : '';
      const safeName = ext ? `${slugify(base)}.${ext}` : slugify(base);
      const safeFolder = folder ? slugify(folder) : undefined;
      const uniqueFileName = safeFolder
        ? `${safeFolder}/${Date.now()}-${safeName}`
        : `${Date.now()}-${safeName}`;
      const file = bucket.file(uniqueFileName);

      await file.save(fileBuffer, {
        metadata: {
          contentType: mimeType,
        },
        predefinedAcl: 'publicRead',
      });

      const encodedPath = uniqueFileName.split('/').map(encodeURIComponent).join('/');
      const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${encodedPath}`;
      
      console.log(`✅ Image uploaded successfully: ${publicUrl}`);
      
      return publicUrl;
    } catch (error: any) {
      console.error('❌ Error uploading image to Google Cloud Storage:', error.message || error);
      throw new Error(`Failed to upload image: ${error.message}`);
    }
  }

  isConfigured(): boolean {
    return this.projectId !== null;
  }
}

export const googleStorageService = new GoogleStorageService();
