import { google } from 'googleapis';

// OAuth Authentication - User login required
class GoogleOAuthAuth {
  private oauth2Client: any;
  private mybusinessaccountmanagement: any;
  private mybusinessbusinessinformation: any;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      
      if (!clientId || !clientSecret) {
        throw new Error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables');
      }
      
      // Initialize OAuth2 client for authenticated API calls
      // Uses a default redirect URI - the actual redirect is handled per-request during login
      const defaultCallback = process.env.APP_URL
        ? `${process.env.APP_URL}/auth/google/callback`
        : 'http://localhost:5000/auth/google/callback';
        
      this.oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        defaultCallback
      );

      // Listen for automatic token refreshes and persist the new token to the DB
      this.oauth2Client.on('tokens', async (tokens: any) => {
        if (tokens.access_token) {
          this.accessToken = tokens.access_token;
          if (tokens.refresh_token) this.refreshToken = tokens.refresh_token;
          try {
            const { db } = await import('./db');
            const { users } = await import('../shared/schema');
            const { isNotNull } = await import('drizzle-orm');
            const updates: Record<string, string> = { accessToken: tokens.access_token };
            if (tokens.refresh_token) updates.refreshToken = tokens.refresh_token;
            await db.update(users).set(updates).where(isNotNull(users.accessToken));
            console.log('🔄 Persisted refreshed access token to DB');
          } catch (e) {
            console.error('⚠️ Failed to persist refreshed token to DB:', e);
          }
        }
      });

      console.log('✅ Google OAuth authentication initialized');
    } catch (error) {
      console.error('❌ Failed to initialize Google OAuth:', error);
      throw new Error('Google OAuth setup failed');
    }
  }
  
  // Helper to get the callback URL for a given origin
  private getCallbackUrl(origin?: string): string {
    if (origin) {
      return `${origin}/auth/google/callback`;
    } else if (process.env.APP_URL) {
      return `${process.env.APP_URL}/auth/google/callback`;
    } else {
      return 'http://localhost:5000/auth/google/callback';
    }
  }

  // Generate OAuth authorization URL with dynamic callback based on request origin
  getAuthUrl(origin?: string) {
    const scopes = [
      'https://www.googleapis.com/auth/business.manage',
      'https://www.googleapis.com/auth/devstorage.read_write',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/gmail.send'
    ];
    
    const callbackUrl = this.getCallbackUrl(origin);
    console.log(`🔗 OAuth callback URL set to: ${callbackUrl}`);
    
    // Use redirect_uri parameter in generateAuthUrl instead of replacing the client
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      redirect_uri: callbackUrl
    });
  }

  // Handle OAuth callback and store tokens (uses origin to match callback URL)
  async handleCallback(code: string, origin?: string) {
    try {
      const callbackUrl = this.getCallbackUrl(origin);
      console.log(`🔗 Exchanging code with callback URL: ${callbackUrl}`);
      
      // Create a temporary OAuth2 client for token exchange with the correct redirect URI
      const tempClient = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        callbackUrl
      );
      
      const { tokens } = await tempClient.getToken(code);
      
      // Set credentials on the main client for API calls
      this.oauth2Client.setCredentials(tokens);
      
      this.accessToken = tokens.access_token || null;
      this.refreshToken = tokens.refresh_token || null;
      
      // Initialize API clients with authenticated OAuth client
      this.mybusinessaccountmanagement = google.mybusinessaccountmanagement({
        version: 'v1',
        auth: this.oauth2Client
      });

      this.mybusinessbusinessinformation = google.mybusinessbusinessinformation({
        version: 'v1', 
        auth: this.oauth2Client
      });
      
      console.log('✅ OAuth tokens received and API clients initialized');
      return tokens;
    } catch (error) {
      console.error('❌ Error handling OAuth callback:', error);
      throw new Error('Failed to handle OAuth callback');
    }
  }

  // Restore tokens from database (e.g., after server restart)
  async restoreTokens(accessToken: string, refreshToken?: string | null) {
    try {
      this.accessToken = accessToken;
      this.refreshToken = refreshToken || null;
      
      this.oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken || undefined
      });
      
      // Initialize API clients with restored credentials
      this.mybusinessaccountmanagement = google.mybusinessaccountmanagement({
        version: 'v1',
        auth: this.oauth2Client
      });

      this.mybusinessbusinessinformation = google.mybusinessbusinessinformation({
        version: 'v1',
        auth: this.oauth2Client
      });
      
      console.log('✅ OAuth tokens restored from database');
    } catch (error) {
      console.error('❌ Error restoring tokens:', error);
      throw new Error('Failed to restore authentication tokens');
    }
  }

  // Check if user is authenticated
  isAuthenticated() {
    return !!this.accessToken && !!this.mybusinessaccountmanagement;
  }

  // Get user info from Google
  async getUserInfo() {
    if (!this.accessToken) {
      throw new Error('Not authenticated');
    }

    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data } = await oauth2.userinfo.get();
      
      return {
        googleId: data.id || '',
        email: data.email || '',
        name: data.name || '',
      };
    } catch (error) {
      console.error('Error fetching user info:', error);
      throw new Error('Failed to fetch user info');
    }
  }

  // Get all top-level business accounts with rate limiting
  async getAccounts() {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      const response = await this.mybusinessaccountmanagement.accounts.list();
      console.log(`📊 Found ${response.data.accounts?.length || 0} top-level accounts/folders`);
      return response.data.accounts || [];
    } catch (error: any) {
      if (error.code === 429) {
        console.log('⏱️ Google API rate limit reached - this is normal for free tier');
        console.log('🔄 The integration is working! You can increase quotas in Google Cloud Console');
        return [];
      }
      console.error('Error fetching accounts:', error.message || error);
      return [];
    }
  }

  // Get accounts within a specific parent folder/account
  async getAccountsInFolder(parentAccountName: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      console.log(`📁 Fetching accounts inside folder: ${parentAccountName}`);
      const response = await this.mybusinessaccountmanagement.accounts.list({
        filter: `parentAccount=${parentAccountName}`
      });
      const accounts = response.data.accounts || [];
      console.log(`📊 Found ${accounts.length} accounts inside folder ${parentAccountName}`);
      return accounts;
    } catch (error: any) {
      if (error.code === 429) {
        console.log('⏱️ Google API rate limit reached - this is normal for free tier');
        return [];
      }
      console.error(`Error fetching accounts in folder ${parentAccountName}:`, error.message || error);
      return [];
    }
  }

  // Get ALL locations across all accessible accounts (with pagination)
  async getAllLocations() {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      let allLocations: any[] = [];
      let pageToken: string | undefined = undefined;
      
      console.log(`🔍 Fetching ALL locations across all accounts using wildcard...`);
      
      // averageRating and reviewCount are NOT valid readMask fields in the mybusinessbusinessinformation v1 API
      // (they belong to the older mybusiness v4 API). Including them causes a 400 "invalid argument" error.
      // `latlng` returns the verified pin coordinate (LatLng object) used by the map view.
      const READ_MASK = 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,metadata,openInfo,profile,latlng';

      // mybusinessbusinessinformation.locations.list is not available in the googleapis SDK
      // Use direct HTTP request instead (the SDK's discovery document omits this method)
      do {
        const params = new URLSearchParams({
          readMask: READ_MASK,
          pageSize: '100',
        });
        if (pageToken) params.set('pageToken', pageToken);

        const response: any = await this.oauth2Client.request({
          url: `https://mybusinessbusinessinformation.googleapis.com/v1/accounts/-/locations?${params.toString()}`,
          method: 'GET',
        });
        
        const locations = response.data.locations || [];
        allLocations.push(...locations);
        pageToken = response.data.nextPageToken;
        
        if (pageToken) {
          console.log(`📍 Fetched ${locations.length} locations, getting next page...`);
        } else {
          console.log(`📍 Fetched ${locations.length} locations (final page)`);
        }
      } while (pageToken);
      
      console.log(`✅ Successfully fetched ${allLocations.length} TOTAL locations across all accounts`);
      return allLocations;
    } catch (error) {
      console.error('Error fetching all locations:', error);
      return [];
    }
  }

  // Get locations for a specific account (with pagination)
  async getLocations(accountName: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      let allLocations: any[] = [];
      let pageToken: string | undefined = undefined;
      
      console.log(`🔍 Fetching locations for account: ${accountName}`);

      const READ_MASK = 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,metadata,openInfo,profile,latlng';

      // mybusinessbusinessinformation.locations.list is not available in the googleapis SDK
      // Use direct HTTP request instead
      do {
        const params = new URLSearchParams({
          readMask: READ_MASK,
          pageSize: '100',
        });
        if (pageToken) params.set('pageToken', pageToken);

        const response: any = await this.oauth2Client.request({
          url: `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params.toString()}`,
          method: 'GET',
        });
        
        const locations = response.data.locations || [];
        allLocations.push(...locations);
        pageToken = response.data.nextPageToken;
        
        if (pageToken) {
          console.log(`📍 Fetched ${locations.length} locations, getting next page...`);
        } else {
          console.log(`📍 Fetched ${locations.length} locations (final page)`);
        }
      } while (pageToken);
      
      console.log(`✅ Successfully fetched ${allLocations.length} total locations for ${accountName}`);
      return allLocations;
    } catch (error) {
      console.error('Error fetching locations:', error);
      return [];
    }
  }

  // Create a post for a location
  async createPost(locationName: string, postData: any) {
    try {
      console.log(`📝 Creating post for location: ${locationName}`);
      console.log('📝 Post payload:', JSON.stringify(postData, null, 2));
      
      // Sanitize the CTA URL — strip any text prefix like "Website: " before the actual URL
      const rawCtaUrl: string = postData.callToAction.url || "";
      const urlMatch = rawCtaUrl.match(/https?:\/\/\S+/);
      const cleanCtaUrl = urlMatch ? urlMatch[0] : rawCtaUrl;
      if (cleanCtaUrl !== rawCtaUrl) {
        console.log(`🔧 Sanitized CTA URL: "${rawCtaUrl}" → "${cleanCtaUrl}"`);
      }

      // Build the request body matching GBP API v4 format
      const requestBody: any = {
        languageCode: postData.languageCode || "en-US",
        summary: postData.summary,
        callToAction: {
          actionType: postData.callToAction.actionType,
          url: cleanCtaUrl
        },
        topicType: postData.topicType || "STANDARD"
      };

      // Add media if present
      if (postData.media && postData.media.length > 0) {
        requestBody.media = postData.media.map((m: any) => ({
          mediaFormat: m.mediaFormat || "PHOTO",
          sourceUrl: m.sourceUrl
        }));
      }

      console.log('📝 ===== CALLING GBP API v4 =====');
      console.log(JSON.stringify(requestBody, null, 2));
      console.log('📝 ================================');
      
      // Extract account ID and location ID from locationName
      // Handle both formats: "accounts/{accountId}/locations/{locationId}" or "locations/{locationId}"
      let accountId: string;
      let locationId: string;
      
      const fullMatch = locationName.match(/accounts\/([^\/]+)\/locations\/([^\/]+)/);
      if (fullMatch) {
        [, accountId, locationId] = fullMatch;
      } else {
        // If only "locations/{locationId}", we need to get the account ID from the authenticated user
        const locationMatch = locationName.match(/locations\/([^\/]+)/);
        if (!locationMatch) {
          throw new Error('Invalid location name format');
        }
        locationId = locationMatch[1];
        
        // Get the account ID from the business profile API
        // We'll need to fetch accounts and find which one owns this location
        const accounts: any = await this.mybusinessaccountmanagement.accounts.list();
        if (!accounts.data.accounts || accounts.data.accounts.length === 0) {
          throw new Error('No business accounts found');
        }
        // Use the first account ID (most common case is single account)
        accountId = accounts.data.accounts[0].name.split('/')[1];
      }
      
      // Make the actual API call to GMB API v4
      const apiUrl = `https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/localPosts`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${(await this.oauth2Client.getAccessToken()).token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ GMB API Error:', errorText);
        throw new Error(`GMB API Error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Post created successfully:', result);
      
      return {
        success: true,
        name: result.name,
        message: 'Post created successfully',
        postData: result
      };
    } catch (error: any) {
      console.error('❌ Error creating post:', error.message || error);
      throw error;
    }
  }

  // Delete a post from a location
  async deletePost(gbpPostName: string) {
    try {
      console.log(`🗑️ Deleting post: ${gbpPostName}`);
      
      // The gbpPostName is in the format: accounts/{accountId}/locations/{locationId}/localPosts/{postId}
      // Extract components for debugging
      const parts = gbpPostName.split('/');
      console.log(`🔍 Post name parts:`, parts);
      
      // Try the v4 API first (standard approach)
      const apiUrl = `https://mybusiness.googleapis.com/v4/${gbpPostName}`;
      console.log(`🌐 DELETE URL: ${apiUrl}`);
      
      const token = (await this.oauth2Client.getAccessToken()).token;
      console.log(`🔑 Token available: ${!!token}`);
      
      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        }
      });

      console.log(`📡 Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ GMB API Delete Error:', errorText);
        
        // If v4 fails with 404, the post might not exist or the API format is different
        // Try alternative: check if it's a permission/scope issue
        if (response.status === 404) {
          console.log('⚠️ Post not found via v4 API - it may have been deleted already or the post ID has changed');
        }
        
        throw new Error(`GMB API Error: ${response.status} - ${errorText}`);
      }

      console.log('✅ Post deleted successfully from Google Business Profile');
      
      return {
        success: true,
        message: 'Post deleted successfully'
      };
    } catch (error: any) {
      console.error('❌ Error deleting post:', error.message || error);
      throw error;
    }
  }

  // Get current hours from Google to verify updates
  async getCurrentHours(locationName: string) {
    try {
      const response = await this.mybusinessbusinessinformation.locations.get({
        name: locationName,
        readMask: 'name,title,regularHours,specialHours'
      });

      return response.data;
    } catch (error) {
      console.error('Error fetching current hours:', error);
      throw new Error('Failed to fetch current hours');
    }
  }

  // Update location hours
  async updateHours(locationName: string, hoursData: any) {
    try {
      console.log(`🕐 Updating hours for location: ${locationName}`);
      
      // Helper function to parse time string "HH:MM" to Google's TimeOfDay format
      const parseTime = (timeString: string) => {
        const [hours, minutes] = timeString.split(':').map(Number);
        return { hours, minutes };
      };

      // Check if this is special hours or regular hours
      if (hoursData.specialHours) {
        // Handle special hours
        console.log('🎉 Updating special hours');
        
        // Fetch existing special hours first to preserve them
        let existingSpecialHours: any[] = [];
        try {
          const currentData = await this.getCurrentHours(locationName);
          existingSpecialHours = currentData.specialHours?.specialHourPeriods || [];
          console.log(`📋 Found ${existingSpecialHours.length} existing special hour periods`);
        } catch (error) {
          console.log('⚠️ Could not fetch existing special hours, proceeding with new ones only');
        }
        
        // Convert new special hours to API format
        const newSpecialHourPeriods = hoursData.specialHours.map((period: any) => {
          const dateParts = period.date.split('-');
          const specialPeriod: any = {
            startDate: {
              year: parseInt(dateParts[0]),
              month: parseInt(dateParts[1]),
              day: parseInt(dateParts[2])
            }
          };
          
          // For closed days, add closed: true
          if (period.isClosed) {
            specialPeriod.closed = true;
          } else {
            // For open days add times as objects
            specialPeriod.openTime = parseTime(period.openTime);
            specialPeriod.closeTime = parseTime(period.closeTime);
          }
          
          return specialPeriod;
        });
        
        // Merge existing and new special hours (new ones override same dates)
        const dateKey = (period: any) => 
          `${period.startDate.year}-${period.startDate.month}-${period.startDate.day}`;
        
        const newDates = new Set(newSpecialHourPeriods.map(dateKey));
        const mergedPeriods = [
          ...existingSpecialHours.filter((period: any) => !newDates.has(dateKey(period))),
          ...newSpecialHourPeriods
        ];
        
        console.log(`📅 Sending ${mergedPeriods.length} total special hour periods (${newSpecialHourPeriods.length} new, ${existingSpecialHours.length - (mergedPeriods.length - newSpecialHourPeriods.length)} preserved)`);

        const response = await this.mybusinessbusinessinformation.locations.patch({
          name: locationName,
          updateMask: 'specialHours',
          requestBody: {
            specialHours: {
              specialHourPeriods: mergedPeriods
            }
          }
        });

        console.log('✅ Special hours updated successfully');
        return response.data;
      }

      // Handle regular hours
      const periods = [];
      const dayMap: Record<string, string> = {
        'monday': 'MONDAY',
        'tuesday': 'TUESDAY',
        'wednesday': 'WEDNESDAY',
        'thursday': 'THURSDAY',
        'friday': 'FRIDAY',
        'saturday': 'SATURDAY',
        'sunday': 'SUNDAY'
      };

      // Unwrap regularHours if the data is wrapped in it (frontend sends { regularHours: {...} })
      const regularHoursData = hoursData.regularHours || hoursData;
      console.log('📋 Processing regular hours data:', JSON.stringify(regularHoursData, null, 2));

      // Convert from {monday: {isOpen, openTime, closeTime}} to periods array
      for (const [day, hours] of Object.entries(regularHoursData)) {
        const dayUpper = dayMap[day.toLowerCase()];
        if (dayUpper && (hours as any).isOpen) {
          periods.push({
            openDay: dayUpper,
            openTime: parseTime((hours as any).openTime),
            closeDay: dayUpper,
            closeTime: parseTime((hours as any).closeTime)
          });
        }
      }
      
      console.log(`📋 Built ${periods.length} period(s) for regular hours update`);

      const response = await this.mybusinessbusinessinformation.locations.patch({
        name: locationName,
        updateMask: 'regularHours',
        requestBody: {
          regularHours: {
            periods: periods
          }
        }
      });

      console.log('✅ Hours updated successfully');
      
      // Fetch and log the current hours from Google to verify the update
      try {
        const verifyData = await this.getCurrentHours(locationName);
        console.log('📋 Verified hours from Google API:', JSON.stringify(verifyData.regularHours, null, 2));
      } catch (verifyError) {
        console.warn('Could not verify hours from Google:', verifyError);
      }
      
      return response.data;
    } catch (error: any) {
      console.error('Error updating hours:', error);
      // Pass through detailed error message from Google API
      const errorMessage = error?.response?.data?.error?.message || error?.message || 'Failed to update hours';
      throw new Error(errorMessage);
    }
  }

  // Update location details (phone, website, description)
  async updateLocationDetails(locationName: string, details: { 
    phone?: string; 
    website?: string; 
    description?: string;
  }) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }

    try {
      console.log(`📝 Updating location details for: ${locationName}`);
      console.log('📝 Details to update:', JSON.stringify(details, null, 2));

      // Build the update mask and request body based on what fields are provided
      const updateFields: string[] = [];
      const requestBody: any = {};

      if (details.phone !== undefined) {
        updateFields.push('phoneNumbers');
        // GBP API expects phoneNumbers as an array of objects
        requestBody.phoneNumbers = {
          primaryPhone: details.phone
        };
      }

      if (details.website !== undefined) {
        updateFields.push('websiteUri');
        requestBody.websiteUri = details.website;
      }

      if (details.description !== undefined) {
        updateFields.push('profile.description');
        requestBody.profile = {
          description: details.description
        };
      }

      if (updateFields.length === 0) {
        throw new Error('No fields to update');
      }

      const updateMask = updateFields.join(',');
      console.log(`📝 Update mask: ${updateMask}`);

      const response = await this.mybusinessbusinessinformation.locations.patch({
        name: locationName,
        updateMask: updateMask,
        requestBody: requestBody
      });

      console.log('✅ Location details updated successfully');
      return {
        success: true,
        data: response.data,
        message: 'Location details updated successfully'
      };
    } catch (error: any) {
      console.error('❌ Error updating location details:', error);
      const errorMessage = error?.response?.data?.error?.message || error?.message || 'Failed to update location details';
      throw new Error(errorMessage);
    }
  }

  // Update social media profile URLs for a location via Google Business Profile API.
  // Social media links are stored as URL *attributes* in the mybusinessbusinessinformation v1 API,
  // NOT as a top-level "socialMedia" field on the location resource.
  // Endpoint: PATCH /v1/{locationName}/attributes?attributeMask=attributes/url_youtube,...
  async updateSocialMediaUrls(locationName: string, socialMedia: {
    twitter?: string;
    facebook?: string;
    instagram?: string;
    youtube?: string;
    linkedin?: string;
    tiktok?: string;
    pinterest?: string;
  }, fullLocationName?: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }

    try {
      console.log(`📱 Updating social media URLs for: ${locationName}`);
      console.log('📱 Social media to update:', JSON.stringify(socialMedia, null, 2));

      // Map our field names to GBP attribute names used by the Attributes API.
      // Twitter/X: Google may use "url_x" (new) or "url_twitter" (legacy) — we resolve
      // the correct name after fetching the supported attribute list below.
      const attributeNameMap: Record<string, string[]> = {
        twitter:   ['url_x', 'url_twitter'],  // try new name first, fall back to legacy
        facebook:  ['url_facebook'],
        instagram: ['url_instagram'],
        youtube:   ['url_youtube'],
        linkedin:  ['url_linkedin'],
        tiktok:    ['url_tiktok'],
        pinterest: ['url_pinterest'],
      };

      // Build the initial attribute list using the preferred (first) name for each field.
      // We will re-resolve twitter after the pre-flight if needed.
      const pendingEntries: Array<{ key: string; value: string; candidates: string[] }> = [];
      for (const [key, value] of Object.entries(socialMedia)) {
        const candidates = attributeNameMap[key];
        if (!candidates || !value || value.trim() === '') continue;
        pendingEntries.push({ key, value: value.trim(), candidates });
      }

      if (pendingEntries.length === 0) {
        console.log('📱 No social media URLs to update');
        return { success: true, message: 'No social media URLs to update' };
      }

      // Helper: race a promise against a hard wall-clock timeout.
      // The google-auth-library's gaxios does not reliably honour the `timeout`
      // field on oauth2Client.request(), so we enforce the limit ourselves.
      const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
        return Promise.race([
          promise,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Google API call timed out after ${ms}ms (${label})`)), ms)
          ),
        ]);
      };

      // Pre-flight: fetch the list of attributes this location actually supports so we can
      // pick the correct attribute name for each field (e.g. url_x vs url_twitter) and
      // skip attributes that Google would hang on.
      let supportedAttributeIds: Set<string> | null = null;
      try {
        // The attributes metadata endpoint requires the full parent path:
        // accounts/{accountId}/locations/{locationId}
        const preflightParent = fullLocationName || locationName;
        const categoryResponse: any = await withTimeout(
          this.oauth2Client.request({
            url: `https://mybusinessbusinessinformation.googleapis.com/v1/attributes`,
            method: 'GET',
            params: { parent: preflightParent, languageCode: 'en' },
          }),
          10000,
          'pre-flight attributes list'
        );
        const supported = (categoryResponse.data?.attributeMetadata || []) as any[];
        // attributeId may come back as "url_linkedin" or "attributes/url_linkedin" — normalise to full form
        supportedAttributeIds = new Set(supported.map((a: any) => {
          const id: string = a.attributeId || '';
          return id.startsWith('attributes/') ? id : `attributes/${id}`;
        }));
        console.log(`📱 Supported attribute IDs for ${locationName}: ${[...supportedAttributeIds].join(', ')}`);
      } catch (metaErr: any) {
        // If we can't fetch supported attributes, proceed optimistically with first candidate per field
        console.log('📱 Could not fetch supported attributes, proceeding without filter:', metaErr?.message);
      }

      // Resolve each pending entry to the best candidate name:
      // - If supported list is known, pick the first candidate that appears in it.
      // - If supported list is unknown (pre-flight failed), use the first candidate.
      const filteredAttributes: Array<{ name: string; uriValues: Array<{ uri: string }> }> = [];
      const filteredMaskParts: string[] = [];

      for (const { value, candidates } of pendingEntries) {
        let resolved: string | null = null;
        if (supportedAttributeIds) {
          resolved = candidates.map(c => `attributes/${c}`).find(f => supportedAttributeIds!.has(f)) ?? null;
        } else {
          resolved = `attributes/${candidates[0]}`;
        }
        if (!resolved) continue; // not supported by this location — skip
        filteredAttributes.push({ name: resolved, uriValues: [{ uri: value }] });
        filteredMaskParts.push(resolved);
      }

      if (filteredAttributes.length === 0) {
        console.log('📱 No supported social media attributes to update for this location');
        return { success: true, message: 'No supported social media attributes to update' };
      }

      const filteredMask = filteredMaskParts.join(',');
      console.log(`📱 Sending ${filteredAttributes.length} filtered attributes:`, JSON.stringify(filteredAttributes, null, 2));
      console.log(`📱 attributeMask: ${filteredMask}`);

      // Helper to execute the PATCH with a given attribute list
      const doPatch = (attrs: typeof filteredAttributes, mask: string) =>
        withTimeout(
          this.oauth2Client.request({
            url: `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}/attributes`,
            method: 'PATCH',
            params: { attributeMask: mask },
            data: { name: `${locationName}/attributes`, attributes: attrs },
          }),
          15000,
          'PATCH attributes'
        );

      let patchResponse: any;
      try {
        patchResponse = await doPatch(filteredAttributes, filteredMask);
      } catch (firstErr: any) {
        const isInvalidArg =
          firstErr?.response?.data?.error?.status === 'INVALID_ARGUMENT' ||
          (firstErr?.message || '').toLowerCase().includes('invalid argument');

        // Check whether any field has an untried fallback candidate
        const hasFallback = pendingEntries.some(e => e.candidates.length > 1);

        if (isInvalidArg && hasFallback) {
          // Build a retry attribute list using the NEXT candidate for every multi-candidate
          // field (e.g. swap url_x → url_twitter for Twitter)
          console.log('📱 PATCH failed with invalid argument — retrying with fallback attribute names');
          const retryAttributes: typeof filteredAttributes = [];
          const retryMaskParts: string[] = [];

          for (const { value, candidates } of pendingEntries) {
            if (candidates.length < 2) {
              // Single-candidate field: keep as-is if it was in the filtered list
              const existing = filteredAttributes.find(a => a.name === `attributes/${candidates[0]}`);
              if (existing) {
                retryAttributes.push(existing);
                retryMaskParts.push(existing.name);
              }
            } else {
              // Multi-candidate field: pick the first candidate NOT already tried (index 1+)
              const triedName = filteredAttributes.find(a =>
                candidates.some(c => a.name === `attributes/${c}`)
              )?.name;
              const triedSlug = triedName?.replace('attributes/', '');
              const nextCandidate = candidates.find(c => c !== triedSlug);
              if (nextCandidate) {
                const fallbackName = `attributes/${nextCandidate}`;
                console.log(`📱 Swapping ${triedName} → ${fallbackName}`);
                retryAttributes.push({ name: fallbackName, uriValues: [{ uri: value }] });
                retryMaskParts.push(fallbackName);
              }
            }
          }

          if (retryAttributes.length > 0) {
            const retryMask = retryMaskParts.join(',');
            patchResponse = await doPatch(retryAttributes, retryMask);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }

      console.log('✅ Social media attributes updated successfully on Google');
      return { success: true, data: patchResponse.data, message: 'Social media URLs updated successfully' };
    } catch (error: any) {
      console.error('❌ Error updating social media URLs:', error);
      const errorMessage = error?.response?.data?.error?.message || error?.message || 'Failed to update social media URLs';
      if (error?.response?.data) {
        console.error('❌ API Error details:', JSON.stringify(error.response.data, null, 2));
      }
      throw new Error(errorMessage);
    }
  }

  // Upload photos to a location  
  async uploadPhoto(locationName: string, photoData: any) {
    try {
      console.log(`📷 Uploading photo for location: ${locationName}`);
      
      // Note: Photo uploads require separate media upload process
      // This is a placeholder implementation
      
      return {
        success: true,
        name: `${locationName}/media/uploaded-${Date.now()}`,
        message: 'Photo uploaded successfully (placeholder implementation)'
      };
    } catch (error) {
      console.error('Error uploading photo:', error);
      throw new Error('Failed to upload photo');
    }
  }

  // Get reviews for a location (with pagination)
  async getReviews(locationName: string, startDate?: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      console.log(`⭐ Fetching reviews for location: ${locationName}${startDate ? ` (since ${startDate})` : ''}`);
      
      let accountId: string;
      let locationId: string;
      
      const fullMatch = locationName.match(/accounts\/([^\/]+)\/locations\/([^\/]+)/);
      if (fullMatch) {
        [, accountId, locationId] = fullMatch;
      } else {
        const locationMatch = locationName.match(/locations\/([^\/]+)/);
        if (!locationMatch) {
          throw new Error('Invalid location name format');
        }
        locationId = locationMatch[1];
        
        const accounts: any = await this.mybusinessaccountmanagement.accounts.list();
        if (!accounts.data.accounts || accounts.data.accounts.length === 0) {
          throw new Error('No business accounts found');
        }
        accountId = accounts.data.accounts[0].name.split('/')[1];
      }
      
      const allReviews: any[] = [];
      let pageToken: string | null = null;
      const maxPages = 50;
      let pageCount = 0;
      let shouldStop = false;
      
      const startDateObj = startDate ? new Date(startDate) : null;
      if (startDateObj) {
        startDateObj.setHours(0, 0, 0, 0);
      }
      
      do {
        const apiUrl = new URL(`https://mybusiness.googleapis.com/v4/accounts/${accountId}/locations/${locationId}/reviews`);
        // Explicitly request newest-updated first so the early-stop optimization
        // below is deterministic and correct.
        apiUrl.searchParams.set('orderBy', 'updateTime desc');
        if (pageToken) {
          apiUrl.searchParams.set('pageToken', pageToken);
        }
        
        const response = await fetch(apiUrl.toString(), {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${(await this.oauth2Client.getAccessToken()).token}`,
            'Content-Type': 'application/json',
          }
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ Reviews API Error:', errorText);
          
          if (response.status === 403 || response.status === 404) {
            console.log('ℹ️ Reviews not available for this location');
            return allReviews;
          }
          
          throw new Error(`Reviews API Error: ${response.status} - ${errorText}`);
        }

        const result = await response.json();
        const reviews = result.reviews || [];
        
        for (const review of reviews) {
          // Important: stop based on UPDATE time, not create time. The Google
          // Business Profile API sorts reviews by updateTime desc, so an older
          // review that was recently edited (or replied to) appears near the
          // top. If we stopped based on createTime here, we'd bail out too
          // early and miss newer reviews further down the list. Since
          // updateTime >= createTime is always true, stopping when updateTime
          // < startDate is safe — every remaining review must also have
          // createTime < startDate.
          if (startDateObj) {
            const compareTimeStr = review.updateTime || review.createTime;
            if (compareTimeStr) {
              const compareDate = new Date(compareTimeStr);
              if (compareDate < startDateObj) {
                shouldStop = true;
                break;
              }
            }
          }
          allReviews.push(review);
        }
        
        pageToken = result.nextPageToken || null;
        pageCount++;
        
        console.log(`⭐ Fetched page ${pageCount}: ${reviews.length} reviews (kept: ${allReviews.length})${shouldStop ? ' - stopping early (older updateTime)' : ''}`);
      } while (pageToken && pageCount < maxPages && !shouldStop);
      
      console.log(`✅ Total fetched ${allReviews.length} reviews across ${pageCount} pages`);
      
      return allReviews;
    } catch (error: any) {
      console.error('❌ Error fetching reviews:', error.message || error);
      return [];
    }
  }

  // Get a specific location with full metadata (including hasGoogleUpdated)
  async getLocation(locationName: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      console.log(`🔍 Fetching location details: ${locationName}`);
      
      const response: any = await this.mybusinessbusinessinformation.locations.get({
        name: locationName,
        readMask: 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,metadata,openInfo,profile,categories,latlng'
      });
      
      return response.data;
    } catch (error: any) {
      console.error('Error fetching location:', error.message || error);
      throw error;
    }
  }

  // Check if a location has Google-suggested updates
  async checkForGoogleUpdates(locationName: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      const location = await this.getLocation(locationName);
      const hasGoogleUpdated = location?.metadata?.hasGoogleUpdated || false;
      
      return {
        hasUpdates: hasGoogleUpdated,
        location
      };
    } catch (error: any) {
      console.error('Error checking for Google updates:', error.message || error);
      return { hasUpdates: false, location: null };
    }
  }

  // Get Google-suggested updates for a location
  async getGoogleUpdatedLocation(locationName: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      console.log(`🔍 Fetching Google-suggested updates for: ${locationName}`);
      
      // Use the getGoogleUpdated endpoint
      const token = (await this.oauth2Client.getAccessToken()).token;
      const readMask = 'name,title,storefrontAddress,phoneNumbers,websiteUri,regularHours,profile,categories,latlng,metadata';
      const apiUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}:getGoogleUpdated?readMask=${encodeURIComponent(readMask)}`;
      
      const response = await fetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ getGoogleUpdated Error:', errorText);
        
        if (response.status === 404) {
          console.log('ℹ️ No Google updates available for this location');
          return null;
        }
        
        throw new Error(`getGoogleUpdated Error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Google-suggested updates:', JSON.stringify(result, null, 2));
      
      return result;
    } catch (error: any) {
      console.error('❌ Error getting Google updates:', error.message || error);
      return null;
    }
  }

  // Accept Google-suggested update by applying the suggested changes
  async acceptGoogleUpdate(locationName: string, suggestedLocation: any, diffMask: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      console.log(`✅ Accepting Google-suggested update for: ${locationName}`);
      console.log(`📋 DiffMask: ${diffMask}`);
      
      // Fields that are completely read-only and cannot be PATCH'd
      const readOnlyFields = new Set(['metadata', 'name']);
      
      // Build the update body with only fields that exist in suggestedLocation
      const updateBody: any = {};
      const validFields: string[] = [];
      
      for (const field of diffMask.split(',')) {
        const trimmedField = field.trim();
        if (!trimmedField || readOnlyFields.has(trimmedField)) continue;
        
        const value = suggestedLocation[trimmedField];
        if (value === undefined || value === null) {
          console.log(`⚠️ Skipping field "${trimmedField}" — no value in suggested location`);
          continue;
        }
        
        // Strip read-only sub-fields from nested objects before sending
        if (trimmedField === 'openInfo' && typeof value === 'object') {
          const { canReopen, ...writableOpenInfo } = value;
          if (Object.keys(writableOpenInfo).length === 0) {
            console.log(`⚠️ Skipping "openInfo" — no writable sub-fields`);
            continue;
          }
          updateBody[trimmedField] = writableOpenInfo;
        } else {
          updateBody[trimmedField] = value;
        }
        
        validFields.push(trimmedField);
      }
      
      if (validFields.length === 0) {
        console.log('ℹ️ No writable fields to accept — marking as accepted without API call');
        return { success: true, skipped: true };
      }
      
      const token = (await this.oauth2Client.getAccessToken()).token;
      const apiUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?updateMask=${validFields.join(',')}`;
      
      console.log(`📤 PATCH ${apiUrl}`);
      console.log(`📤 Body: ${JSON.stringify(updateBody)}`);
      
      const response = await fetch(apiUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Accept update Error:', errorText);
        throw new Error(`Accept update Error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ Google-suggested update accepted successfully');
      
      return { success: true, location: result };
    } catch (error: any) {
      console.error('❌ Error accepting Google update:', error.message || error);
      throw error;
    }
  }

  // Reject Google-suggested update (clear the pending update flag)
  async rejectGoogleUpdate(locationName: string, diffMask: string) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }
    
    try {
      console.log(`❌ Rejecting Google-suggested update for: ${locationName}`);
      
      // To reject, we need to call clearLocationAssociations or update with current values
      // The Business Profile API uses a "clearLocationAssociation" or we can update with original values
      // For now, we'll update the location with its current values to clear the pending update
      
      const currentLocation = await this.getLocation(locationName);
      
      // Filter out read-only fields like 'metadata' from the updateMask
      const readOnlyFields = ['metadata', 'name'];
      const updateableFields = diffMask.split(',')
        .map(f => f.trim())
        .filter(f => !readOnlyFields.includes(f) && f.length > 0)
        .join(',');
      
      if (!updateableFields) {
        console.log('ℹ️ No updateable fields to reject, only metadata changes');
        return { success: true };
      }
      
      const token = (await this.oauth2Client.getAccessToken()).token;
      const apiUrl = `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?updateMask=${updateableFields}`;
      
      // Build update body with current values to reject the suggestion
      const updateBody: any = {};
      const fields = updateableFields.split(',');
      
      // Helper to get nested value
      const getNestedValue = (obj: any, path: string): any => {
        const parts = path.split('.');
        let current = obj;
        for (const part of parts) {
          if (current === undefined || current === null) return undefined;
          current = current[part];
        }
        return current;
      };
      
      // Helper to set nested value
      const setNestedValue = (obj: any, path: string, value: any) => {
        const parts = path.split('.');
        let current = obj;
        for (let i = 0; i < parts.length - 1; i++) {
          if (current[parts[i]] === undefined) {
            current[parts[i]] = {};
          }
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
      };
      
      for (const field of fields) {
        const trimmedField = field.trim();
        if (trimmedField) {
          let value = getNestedValue(currentLocation, trimmedField);
          if (value !== undefined) {
            // Strip read-only sub-fields before sending
            if (trimmedField === 'openInfo' && typeof value === 'object' && value !== null) {
              const { canReopen, ...writableOpenInfo } = value;
              value = Object.keys(writableOpenInfo).length > 0 ? writableOpenInfo : undefined;
            }
            if (value !== undefined) {
              setNestedValue(updateBody, trimmedField, value);
            }
          }
        }
      }
      
      const response = await fetch(apiUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Reject update Error:', errorText);
        throw new Error(`Reject update Error: ${response.status} - ${errorText}`);
      }

      console.log('✅ Google-suggested update rejected successfully');
      
      return { success: true };
    } catch (error: any) {
      console.error('❌ Error rejecting Google update:', error.message || error);
      throw error;
    }
  }

  // Fetch GBP Performance Metrics for a location from the Performance API
  async getLocationPerformanceMetrics(locationName: string, startDate: Date, endDate: Date) {
    if (!this.isAuthenticated()) {
      throw new Error('User not authenticated. Please log in first.');
    }

    const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`Google API call timed out after ${ms}ms (${label})`)), ms)
        ),
      ]);
    };

    const metricTypes = [
      'CALL_CLICKS',
      'WEBSITE_CLICKS',
      'BUSINESS_DIRECTION_REQUESTS',
      'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
      'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
      'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
      'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    ];

    const requestParams: Record<string, any> = {
      dailyMetrics: metricTypes,
      'dailyRange.startDate.year': startDate.getFullYear(),
      'dailyRange.startDate.month': startDate.getMonth() + 1,
      'dailyRange.startDate.day': startDate.getDate(),
      'dailyRange.endDate.year': endDate.getFullYear(),
      'dailyRange.endDate.month': endDate.getMonth() + 1,
      'dailyRange.endDate.day': endDate.getDate(),
    };

    console.log(`📊 Fetching performance metrics for ${locationName}`);

    const response: any = await withTimeout(
      this.oauth2Client.request({
        url: `https://businessprofileperformance.googleapis.com/v1/${locationName}:fetchMultiDailyMetricsTimeSeries`,
        method: 'GET',
        params: requestParams,
      }),
      15000,
      'performance metrics fetchMultipleDailyMetricsTimeSeries'
    );

    // Response: { multiDailyMetricTimeSeries: MultiDailyMetricTimeSeries[] }
    // Each MultiDailyMetricTimeSeries has: { dailyMetricTimeSeries: DailyMetricTimeSeries[] }
    // Each DailyMetricTimeSeries has: { dailyMetric: string, timeSeries: { datedValues: [{date, value}] } }
    const multiDailyMetricTimeSeries: any[] = response?.data?.multiDailyMetricTimeSeries || [];

    // Build a date-indexed map for the daily impressions chart
    const dailyMap: Record<string, { date: string; impressions: number; callClicks: number; websiteClicks: number; directionRequests: number }> = {};

    // Iterate over dates in range to pre-populate
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = cursor.toISOString().slice(0, 10);
      dailyMap[key] = { date: key, impressions: 0, callClicks: 0, websiteClicks: 0, directionRequests: 0 };
      cursor.setDate(cursor.getDate() + 1);
    }

    let totalCallClicks = 0;
    let totalWebsiteClicks = 0;
    let totalDirectionRequests = 0;
    let totalImpressions = 0;

    for (const multi of multiDailyMetricTimeSeries) {
      // dailyMetricTimeSeries is an ARRAY inside each multi item
      const dtsArray: any[] = multi.dailyMetricTimeSeries || [];
      for (const dts of dtsArray) {
        const metric: string = dts.dailyMetric || '';
        const dataPoints: any[] = dts.timeSeries?.datedValues || [];

        for (const point of dataPoints) {
          const { date: d, value } = point;
          if (!d) continue;
          const dateKey = `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
          const val = parseInt(value || '0', 10) || 0;

          if (!dailyMap[dateKey]) {
            dailyMap[dateKey] = { date: dateKey, impressions: 0, callClicks: 0, websiteClicks: 0, directionRequests: 0 };
          }

          if (metric === 'CALL_CLICKS') {
            dailyMap[dateKey].callClicks += val;
            totalCallClicks += val;
          } else if (metric === 'WEBSITE_CLICKS') {
            dailyMap[dateKey].websiteClicks += val;
            totalWebsiteClicks += val;
          } else if (metric === 'BUSINESS_DIRECTION_REQUESTS') {
            dailyMap[dateKey].directionRequests += val;
            totalDirectionRequests += val;
          } else if (
            metric === 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS' ||
            metric === 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH' ||
            metric === 'BUSINESS_IMPRESSIONS_MOBILE_MAPS' ||
            metric === 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH'
          ) {
            dailyMap[dateKey].impressions += val;
            totalImpressions += val;
          }
        }
      }
    }

    const daily = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return {
      callClicks: totalCallClicks,
      websiteClicks: totalWebsiteClicks,
      directionRequests: totalDirectionRequests,
      impressionsTotal: totalImpressions,
      daily,
    };
  }

  // Logout and clear tokens
  logout() {
    try {
      // Clear all tokens and credentials
      this.accessToken = null;
      this.refreshToken = null;
      this.mybusinessaccountmanagement = null;
      this.mybusinessbusinessinformation = null;
      
      // Clear OAuth client credentials by setting them to an empty object
      // and explicitly removing the credentials
      this.oauth2Client.credentials = {};
      this.oauth2Client.setCredentials({});
      
      console.log('✅ User logged out - all tokens and credentials cleared');
    } catch (error) {
      console.error('Error during logout:', error);
      throw new Error('Failed to logout');
    }
  }
}

// Singleton instance for the entire application
export const googleOAuthAuth = new GoogleOAuthAuth();