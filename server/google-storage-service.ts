import { Storage } from '@google-cloud/storage';

class GoogleStorageService {
  private bucketName = 'gbp_management_photos';
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

  async uploadImage(fileBuffer: Buffer, fileName: string, mimeType: string): Promise<string> {
    if (!this.projectId) {
      throw new Error('Google Cloud Storage not configured');
    }

    try {
      const storage = await this.getStorageClient();
      const bucket = storage.bucket(this.bucketName);
      
      const uniqueFileName = `${Date.now()}-${fileName}`;
      const file = bucket.file(uniqueFileName);

      await file.save(fileBuffer, {
        metadata: {
          contentType: mimeType,
        },
        predefinedAcl: 'publicRead',
      });

      const publicUrl = `https://storage.googleapis.com/${this.bucketName}/${uniqueFileName}`;
      
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
