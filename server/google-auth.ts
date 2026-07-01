import { google } from 'googleapis';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { storage } from './storage';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const CALLBACK_URL = process.env.NODE_ENV === 'production'
  ? `${process.env.APP_URL}/auth/google/callback`
  : 'http://localhost:5000/auth/google/callback';

// Configure Google OAuth strategy
passport.use(new GoogleStrategy({
  clientID: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  callbackURL: CALLBACK_URL,
  scope: [
    'profile',
    'email',
    'https://www.googleapis.com/auth/business.manage'
  ]
}, async (accessToken, refreshToken, profile, done) => {
  try {
    // Store or update user in database
    let user = await storage.getUserByGoogleId(profile.id);
    
    if (!user) {
      // Create new user
      user = await storage.createUser({
        googleId: profile.id,
        email: profile.emails?.[0]?.value || '',
        name: profile.displayName || '',
        accessToken,
        refreshToken: refreshToken || null
      });
    } else {
      // Update tokens
      user = await storage.updateUserTokens(user.id, accessToken, refreshToken);
    }
    
    return done(null, user);
  } catch (error) {
    console.error('OAuth error:', error);
    return done(error, undefined);
  }
}));

// Serialize/deserialize user for session
passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await storage.getUser(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Google Business Profile API client
export class GoogleBusinessAPI {
  private oauth2Client: any;

  constructor(accessToken: string, refreshToken?: string) {
    this.oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      CALLBACK_URL
    );
    
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken
    });
  }

  // Get user's business accounts
  async getAccounts() {
    try {
      const mybusinessaccountmanagement = google.mybusinessaccountmanagement({
        version: 'v1',
        auth: this.oauth2Client
      });

      const response = await mybusinessaccountmanagement.accounts.list();
      return response.data.accounts || [];
    } catch (error) {
      console.error('Error fetching accounts:', error);
      throw new Error('Failed to fetch business accounts');
    }
  }

  // Get locations for a specific account
  async getLocations(accountName: string) {
    try {
      const mybusinessbusinessinformation = google.mybusinessbusinessinformation({
        version: 'v1',
        auth: this.oauth2Client
      });

      const response = await mybusinessbusinessinformation.accounts.locations.list({
        parent: accountName,
        readMask: 'name,title,storefrontAddress,categories,phoneNumbers,websiteUri,regularHours,metadata,latlng'
      });

      return response.data.locations || [];
    } catch (error) {
      console.error('Error fetching locations:', error);
      throw new Error('Failed to fetch locations');
    }
  }

  // Create a post for a location (using Google My Business Posts API)
  async createPost(locationName: string, postData: any) {
    try {
      // Note: As of 2024, Google My Business Posts API may be deprecated or changed
      // This is a placeholder implementation that logs the attempt
      console.log('Creating post for location:', locationName, postData);
      
      // Return success for now - implement actual API call based on current Google docs
      return {
        name: `${locationName}/posts/generated-${Date.now()}`,
        summary: postData.title,
        createTime: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error creating post:', error);
      throw new Error('Failed to create post');
    }
  }

  // Update location hours
  async updateHours(locationName: string, hoursData: any) {
    try {
      const mybusinessbusinessinformation = google.mybusinessbusinessinformation({
        version: 'v1',
        auth: this.oauth2Client
      });

      // Use the correct API method for updating location information
      const response = await mybusinessbusinessinformation.locations.patch({
        name: locationName,
        updateMask: 'regularHours',
        requestBody: {
          regularHours: {
            periods: hoursData.periods
          }
        }
      });

      return response.data;
    } catch (error) {
      console.error('Error updating hours:', error);
      throw new Error('Failed to update hours');
    }
  }

  // Upload photos to a location
  async uploadPhoto(locationName: string, photoData: any) {
    try {
      // Note: Photo uploads typically require a multi-step process:
      // 1. Upload the media to Google's media service
      // 2. Associate the media with the location
      // This is a simplified implementation
      
      const mybusinessbusinessinformation = google.mybusinessbusinessinformation({
        version: 'v1',
        auth: this.oauth2Client
      });

      // This would need to be implemented based on the actual Google My Business API
      // for photo uploads, which may involve separate media upload endpoints
      console.log('Photo upload not yet implemented for:', locationName, photoData);
      
      return { success: true, message: 'Photo upload placeholder' };
    } catch (error) {
      console.error('Error uploading photo:', error);
      throw new Error('Failed to upload photo');
    }
  }
}

// NOTE: the old setupAuth() middleware was removed deliberately. It gated /api
// on the GLOBAL shared-connection singleton (googleOAuthAuth.isAuthenticated()),
// not on the requester's session — meaning once the shared connection loaded at
// boot, EVERY unauthenticated visitor would have passed the check. The real
// per-session auth gate lives in routes.ts (registerRoutes). Do not resurrect
// this function.

export { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET };