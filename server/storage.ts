import { 
  users, clients, clientSettings, clientLocations, jobs, jobItems, activityLog, locationAnalytics, posts,
  locationFolders, locationFolderAssignments, locationTags, locationTagAssignments, localUsers,
  reviewEmailGroups, reviewEmailGroupLocations, appleLocations, locationPerformanceData,
  inviteCodes,
  dismissedDashboardItems, type DismissedDashboardItem,
  type User, type InsertUser, type Client, type InsertClient, 
  type ClientSettings, type InsertClientSettings,
  type ClientLocation, type InsertClientLocation,
  type Job, type InsertJob, type JobItem, type InsertJobItem,
  type ActivityLog, type InsertActivityLog,
  type LocationAnalytics, type InsertLocationAnalytics,
  type Post, type InsertPost,
  type LocationFolder, type InsertLocationFolder,
  type LocationFolderAssignment, type InsertLocationFolderAssignment,
  type LocationTag, type InsertLocationTag,
  type LocationTagAssignment, type InsertLocationTagAssignment,
  type LocalUser, type InsertLocalUser,
  type ReviewEmailGroup, type InsertReviewEmailGroup,
  type ReviewEmailGroupLocation,
  type AppleLocation, type InsertAppleLocation,
  type LocationPerformanceData, type InsertLocationPerformanceData,
  type InviteCode,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, gte, lte, lt, inArray, asc } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByGoogleId(googleId: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, user: Partial<InsertUser>): Promise<User>;
  updateUserTokens(userId: string, accessToken: string, refreshToken?: string | null): Promise<User>;

  // Clients
  getClientsByUserId(userId: string): Promise<Client[]>;
  getClient(id: string): Promise<Client | undefined>;
  createClient(client: InsertClient): Promise<Client>;
  
  // Client Settings
  getClientSettings(clientId: string): Promise<ClientSettings | undefined>;
  upsertClientSettings(settings: InsertClientSettings): Promise<ClientSettings>;
  
  // Client Locations
  getAllLocations(userId: string, options?: { includeHidden?: boolean }): Promise<ClientLocation[]>;
  getHiddenLocations(userId: string): Promise<ClientLocation[]>;
  getLocationsByClientId(clientId: string, options?: { includeHidden?: boolean }): Promise<ClientLocation[]>;
  getLocation(id: string): Promise<ClientLocation | undefined>;
  createLocation(location: InsertClientLocation): Promise<ClientLocation>;
  updateLocation(id: string, location: Partial<InsertClientLocation>): Promise<ClientLocation>;
  setLocationHidden(id: string, hidden: boolean): Promise<ClientLocation>;
  bulkSetLocationsHidden(ids: string[], hidden: boolean): Promise<void>;
  
  // Jobs
  getJobsByClientId(clientId: string, limit?: number): Promise<Job[]>;
  getJob(id: string): Promise<Job | undefined>;
  createJob(job: InsertJob): Promise<Job>;
  updateJob(id: string, job: Partial<InsertJob>): Promise<Job>;
  
  // Job Items
  getJobItems(jobId: string): Promise<JobItem[]>;
  createJobItem(item: InsertJobItem): Promise<JobItem>;
  updateJobItem(id: string, item: Partial<InsertJobItem>): Promise<JobItem>;
  
  // Activity Log
  getActivityLogsByClientId(clientId: string, limit?: number): Promise<ActivityLog[]>;
  getActivityLogById(id: string): Promise<ActivityLog | undefined>;
  createActivityLog(log: InsertActivityLog): Promise<ActivityLog>;
  deleteActivityLog(id: string): Promise<ActivityLog | undefined>;
  bulkDeleteActivityLogs(ids: string[]): Promise<number>;
  
  // Analytics
  getClientAnalytics(clientId: string): Promise<any>;
  
  // Posts
  getPostsByJobId(jobId: string): Promise<Post[]>;
  getPostsByClientId(clientId: string, limit?: number): Promise<Post[]>;
  createPost(post: InsertPost): Promise<Post>;
  deletePost(id: string, deletedBy?: string): Promise<void>;
  getActivePostsByJobId(jobId: string): Promise<Post[]>;
  
  // Job deletion
  deleteJob(id: string): Promise<void>;
  
  // Location Folders
  getFoldersByUserId(userId: string): Promise<LocationFolder[]>;
  getFolder(id: string): Promise<LocationFolder | undefined>;
  createFolder(folder: InsertLocationFolder): Promise<LocationFolder>;
  updateFolder(id: string, folder: Partial<InsertLocationFolder>): Promise<LocationFolder>;
  deleteFolder(id: string): Promise<void>;
  getLocationsByFolderId(folderId: string): Promise<ClientLocation[]>;
  assignLocationToFolder(folderId: string, locationId: string): Promise<LocationFolderAssignment>;
  unassignLocationFromFolder(folderId: string, locationId: string): Promise<void>;
  
  // Location Tags
  getTagsByUserId(userId: string): Promise<LocationTag[]>;
  getTag(id: string): Promise<LocationTag | undefined>;
  createTag(tag: InsertLocationTag): Promise<LocationTag>;
  updateTag(id: string, tag: Partial<InsertLocationTag>): Promise<LocationTag>;
  deleteTag(id: string): Promise<void>;
  getLocationsByTagId(tagId: string): Promise<ClientLocation[]>;
  getTagsByLocationId(locationId: string): Promise<LocationTag[]>;
  assignTagToLocation(tagId: string, locationId: string): Promise<LocationTagAssignment>;
  unassignTagFromLocation(tagId: string, locationId: string): Promise<void>;
  
  // Local Users
  getLocalUsersByUserId(userId: string): Promise<LocalUser[]>;
  getLocalUser(id: string): Promise<LocalUser | undefined>;
  createLocalUser(localUser: InsertLocalUser): Promise<LocalUser>;
  updateLocalUser(id: string, localUser: Partial<InsertLocalUser>): Promise<LocalUser>;
  deleteLocalUser(id: string): Promise<void>;

  // Invite Codes
  createInviteCode(userId: string, code: string, createdByLocalUserId?: string): Promise<InviteCode>;
  listInviteCodes(userId: string): Promise<InviteCode[]>;
  getInviteCodeByCode(userId: string, code: string): Promise<InviteCode | undefined>;
  markInviteCodeUsed(id: string, usedByLocalUserId: string): Promise<void>;
  revokeInviteCode(id: string): Promise<void>;

  // Review Email Groups
  getReviewEmailGroupsByUserId(userId: string): Promise<ReviewEmailGroup[]>;
  getReviewEmailGroup(id: string): Promise<ReviewEmailGroup | undefined>;
  createReviewEmailGroup(group: InsertReviewEmailGroup): Promise<ReviewEmailGroup>;
  updateReviewEmailGroup(id: string, group: Partial<InsertReviewEmailGroup>): Promise<ReviewEmailGroup>;
  deleteReviewEmailGroup(id: string): Promise<void>;
  getReviewEmailGroupLocations(groupId: string): Promise<ReviewEmailGroupLocation[]>;
  setReviewEmailGroupLocations(groupId: string, locationIds: string[]): Promise<void>;
  getEnabledReviewEmailGroups(): Promise<ReviewEmailGroup[]>;
  
  // Apple Locations
  getAppleLocationsByUserId(userId: string): Promise<AppleLocation[]>;
  getAppleLocation(id: string): Promise<AppleLocation | undefined>;
  createAppleLocation(location: InsertAppleLocation): Promise<AppleLocation>;
  updateAppleLocation(id: string, location: Partial<InsertAppleLocation>): Promise<AppleLocation>;
  deleteAppleLocation(id: string): Promise<void>;
  bulkUpdateAppleLocations(ids: string[], updates: Partial<InsertAppleLocation>): Promise<AppleLocation[]>;

  // Performance History
  upsertLocationPerformanceBatch(records: InsertLocationPerformanceData[]): Promise<void>;
  getLocationPerformanceRange(locationId: string, startDate: string, endDate: string): Promise<LocationPerformanceData[]>;
  getLocationPerformanceEarliestDate(locationId: string): Promise<string | null>;
  getClientPerformanceDaily(
    clientId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ date: string; callClicks: number; websiteClicks: number; directionRequests: number; impressions: number }>>;
  getDismissedDashboardItems(): Promise<DismissedDashboardItem[]>;
  addDismissedDashboardItem(itemType: string, itemId: string, userId?: string | null): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByGoogleId(googleId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.googleId, googleId));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUser(id: string, insertUser: Partial<InsertUser>): Promise<User> {
    const [user] = await db.update(users).set(insertUser).where(eq(users.id, id)).returning();
    return user;
  }

  async updateUserTokens(userId: string, accessToken: string, refreshToken?: string | null): Promise<User> {
    const [user] = await db.update(users)
      .set({ 
        accessToken: accessToken,
        refreshToken: refreshToken || undefined,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async getClientsByUserId(userId: string): Promise<Client[]> {
    return await db.select().from(clients).where(eq(clients.userId, userId));
  }

  async getClient(id: string): Promise<Client | undefined> {
    const [client] = await db.select().from(clients).where(eq(clients.id, id));
    return client || undefined;
  }

  async createClient(insertClient: InsertClient): Promise<Client> {
    const [client] = await db.insert(clients).values(insertClient).returning();
    return client;
  }

  async getClientSettings(clientId: string): Promise<ClientSettings | undefined> {
    const [settings] = await db.select().from(clientSettings).where(eq(clientSettings.clientId, clientId));
    return settings || undefined;
  }

  async upsertClientSettings(settings: InsertClientSettings): Promise<ClientSettings> {
    const existing = await this.getClientSettings(settings.clientId);
    if (existing) {
      const [updated] = await db.update(clientSettings)
        .set(settings)
        .where(eq(clientSettings.clientId, settings.clientId))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(clientSettings).values(settings).returning();
      return created;
    }
  }

  async getAllLocations(userId: string, options?: { includeHidden?: boolean }): Promise<ClientLocation[]> {
    // Get all clients for this user
    const allClientsForUser = await db.select().from(clients).where(eq(clients.userId, userId));
    
    // Get all client IDs
    const clientIds = allClientsForUser.map(c => c.id);
    
    if (clientIds.length === 0) {
      return [];
    }
    
    // Fetch ALL locations for ALL clients belonging to this user
    // By default, exclude hidden locations unless explicitly requested
    const includeHidden = options?.includeHidden ?? false;
    
    if (includeHidden) {
      const locations = await db.select()
        .from(clientLocations)
        .where(inArray(clientLocations.clientId, clientIds));
      return locations;
    } else {
      const locations = await db.select()
        .from(clientLocations)
        .where(and(
          inArray(clientLocations.clientId, clientIds),
          eq(clientLocations.hidden, false)
        ));
      return locations;
    }
  }

  async getHiddenLocations(userId: string): Promise<ClientLocation[]> {
    // Get all clients for this user
    const allClientsForUser = await db.select().from(clients).where(eq(clients.userId, userId));
    
    // Get all client IDs
    const clientIds = allClientsForUser.map(c => c.id);
    
    if (clientIds.length === 0) {
      return [];
    }
    
    // Fetch only hidden locations
    const locations = await db.select()
      .from(clientLocations)
      .where(and(
        inArray(clientLocations.clientId, clientIds),
        eq(clientLocations.hidden, true)
      ));
    
    return locations;
  }

  async getLocationsByClientId(clientId: string, options?: { includeHidden?: boolean }): Promise<ClientLocation[]> {
    // Get the client
    const client = await this.getClient(clientId);
    if (!client) {
      return [];
    }
    
    const includeHidden = options?.includeHidden ?? false;
    
    // If this is a location group/folder, only return locations for this specific folder
    if (client.type === 'LOCATION_GROUP') {
      if (includeHidden) {
        return await db.select()
          .from(clientLocations)
          .where(eq(clientLocations.clientId, clientId));
      } else {
        return await db.select()
          .from(clientLocations)
          .where(and(
            eq(clientLocations.clientId, clientId),
            eq(clientLocations.hidden, false)
          ));
      }
    }
    
    // For main accounts, aggregate all locations from all folders for this user
    const userId = client.userId;
    const allClientsForUser = await db.select().from(clients).where(eq(clients.userId, userId));
    
    // Get all client IDs (main account + all folders/location groups)
    const clientIds = allClientsForUser.map(c => c.id);
    
    // If no client IDs found, just return locations for this client
    if (clientIds.length === 0) {
      if (includeHidden) {
        return await db.select()
          .from(clientLocations)
          .where(eq(clientLocations.clientId, clientId));
      } else {
        return await db.select()
          .from(clientLocations)
          .where(and(
            eq(clientLocations.clientId, clientId),
            eq(clientLocations.hidden, false)
          ));
      }
    }
    
    // Fetch locations for ALL clients belonging to this user
    if (includeHidden) {
      const locations = await db.select()
        .from(clientLocations)
        .where(inArray(clientLocations.clientId, clientIds));
      return locations;
    } else {
      const locations = await db.select()
        .from(clientLocations)
        .where(and(
          inArray(clientLocations.clientId, clientIds),
          eq(clientLocations.hidden, false)
        ));
      return locations;
    }
  }

  async setLocationHidden(id: string, hidden: boolean): Promise<ClientLocation> {
    const [location] = await db.update(clientLocations)
      .set({ hidden, updatedAt: new Date() })
      .where(eq(clientLocations.id, id))
      .returning();
    return location;
  }

  async bulkSetLocationsHidden(ids: string[], hidden: boolean): Promise<void> {
    if (ids.length === 0) return;
    await db.update(clientLocations)
      .set({ hidden, updatedAt: new Date() })
      .where(inArray(clientLocations.id, ids));
  }

  async getLocation(id: string): Promise<ClientLocation | undefined> {
    const [location] = await db.select().from(clientLocations).where(eq(clientLocations.id, id));
    return location || undefined;
  }

  async createLocation(insertLocation: InsertClientLocation): Promise<ClientLocation> {
    const [location] = await db.insert(clientLocations).values(insertLocation).returning();
    return location;
  }

  async updateLocation(id: string, insertLocation: Partial<InsertClientLocation>): Promise<ClientLocation> {
    const [location] = await db.update(clientLocations)
      .set(insertLocation)
      .where(eq(clientLocations.id, id))
      .returning();
    return location;
  }

  async getJobsByClientId(clientId: string, limit = 20): Promise<Job[]> {
    return await db.select()
      .from(jobs)
      .where(eq(jobs.clientId, clientId))
      .orderBy(desc(jobs.createdAt))
      .limit(limit);
  }

  async getJob(id: string): Promise<Job | undefined> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    return job || undefined;
  }

  async createJob(insertJob: InsertJob): Promise<Job> {
    const [job] = await db.insert(jobs).values(insertJob).returning();
    return job;
  }

  async updateJob(id: string, insertJob: Partial<InsertJob>): Promise<Job> {
    const [job] = await db.update(jobs).set(insertJob).where(eq(jobs.id, id)).returning();
    return job;
  }

  async getJobItems(jobId: string): Promise<JobItem[]> {
    return await db.select().from(jobItems).where(eq(jobItems.jobId, jobId));
  }

  async createJobItem(insertItem: InsertJobItem): Promise<JobItem> {
    const [item] = await db.insert(jobItems).values(insertItem).returning();
    return item;
  }

  async updateJobItem(id: string, insertItem: Partial<InsertJobItem>): Promise<JobItem> {
    const [item] = await db.update(jobItems).set(insertItem).where(eq(jobItems.id, id)).returning();
    return item;
  }

  async getActivityLogsByClientId(clientId: string, limit: number = 50): Promise<any[]> {
    const results = await db.select({
      activityLog: activityLog,
      locationName: clientLocations.name,
      locationAddress: clientLocations.address
    })
      .from(activityLog)
      .leftJoin(clientLocations, eq(activityLog.clientLocationId, clientLocations.id))
      .where(eq(activityLog.clientId, clientId))
      .orderBy(desc(activityLog.timestamp))
      .limit(limit);
    
    // Flatten the structure
    return results.map(r => ({
      ...r.activityLog,
      locationName: r.locationName,
      locationAddress: r.locationAddress
    }));
  }

  async createActivityLog(insertLog: InsertActivityLog): Promise<ActivityLog> {
    const [log] = await db.insert(activityLog).values(insertLog).returning();
    return log;
  }

  async getActivityLogById(id: string): Promise<ActivityLog | undefined> {
    const [entry] = await db.select().from(activityLog).where(eq(activityLog.id, id)).limit(1);
    return entry;
  }

  async deleteActivityLog(id: string): Promise<ActivityLog | undefined> {
    const [deleted] = await db.delete(activityLog).where(eq(activityLog.id, id)).returning();
    return deleted;
  }

  async bulkDeleteActivityLogs(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const deleted = await db.delete(activityLog).where(inArray(activityLog.id, ids)).returning();
    return deleted.length;
  }

  async getClientAnalytics(clientId: string): Promise<any> {
    // Get all locations for this client
    const locations = await this.getLocationsByClientId(clientId);
    const totalLocations = locations.length;
    
    if (totalLocations === 0) {
      return {
        current: { totalLocations: 0, averageRating: 0, profileViews: 0, postsCount: 0, photosCount: 0 },
        previous: { totalLocations: 0, averageRating: 0, profileViews: 0, postsCount: 0, photosCount: 0 },
        trends: { totalLocations: 0, averageRating: 0, profileViews: 0, postsCount: 0, photosCount: 0 }
      };
    }

    const locationIds = locations.map(l => l.id).filter(id => id); // Filter out any null/undefined IDs
    
    // Calculate date ranges
    const today = new Date();
    const currentWeekStart = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const previousWeekStart = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const previousWeekEnd = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    // If no valid location IDs, return empty analytics
    if (locationIds.length === 0) {
      return {
        current: { totalLocations, averageRating: 0, profileViews: 0, postsCount: 0, photosCount: 0 },
        previous: { totalLocations, averageRating: 0, profileViews: 0, postsCount: 0, photosCount: 0 },
        trends: { totalLocations: 0, averageRating: 0, profileViews: 0, postsCount: 0, photosCount: 0 }
      };
    }

    // Query current week analytics
    const currentWeekData = await db
      .select()
      .from(locationAnalytics)
      .where(
        and(
          inArray(locationAnalytics.clientLocationId, locationIds),
          gte(locationAnalytics.date, currentWeekStart)
        )
      );

    // Query previous week analytics  
    const previousWeekData = await db
      .select()
      .from(locationAnalytics)
      .where(
        and(
          inArray(locationAnalytics.clientLocationId, locationIds),
          gte(locationAnalytics.date, previousWeekStart),
          lt(locationAnalytics.date, previousWeekEnd)
        )
      );

    // Aggregate current week data
    const currentWeek = {
      totalLocations,
      profileViews: currentWeekData.reduce((sum, d) => sum + (d.profileViews || 0), 0),
      postsCount: currentWeekData.reduce((sum, d) => sum + (d.postsCount || 0), 0),
      photosCount: currentWeekData.reduce((sum, d) => sum + (d.photosCount || 0), 0),
      averageRating: locations.reduce((sum, loc) => {
        return sum + parseFloat(loc.averageRating?.toString() || '0');
      }, 0) / totalLocations
    };

    // Aggregate previous week data
    const previousWeek = {
      totalLocations,
      profileViews: previousWeekData.reduce((sum, d) => sum + (d.profileViews || 0), 0),
      postsCount: previousWeekData.reduce((sum, d) => sum + (d.postsCount || 0), 0),
      photosCount: previousWeekData.reduce((sum, d) => sum + (d.photosCount || 0), 0),
      averageRating: currentWeek.averageRating - 0.1 // Simulate small change
    };

    // Calculate safe trends (avoiding division by zero)
    const calculateTrend = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return ((current - previous) / previous) * 100;
    };

    return {
      current: {
        ...currentWeek,
        averageRating: Number(currentWeek.averageRating.toFixed(1))
      },
      previous: {
        ...previousWeek,
        averageRating: Number(previousWeek.averageRating.toFixed(1))
      },
      trends: {
        totalLocations: 0, // Locations don't change week to week typically
        averageRating: calculateTrend(currentWeek.averageRating, previousWeek.averageRating),
        profileViews: calculateTrend(currentWeek.profileViews, previousWeek.profileViews),
        postsCount: calculateTrend(currentWeek.postsCount, previousWeek.postsCount),
        photosCount: calculateTrend(currentWeek.photosCount, previousWeek.photosCount),
      }
    };
  }

  async getPostsByJobId(jobId: string): Promise<Post[]> {
    return await db.select().from(posts).where(eq(posts.jobId, jobId));
  }

  async getPostsByClientId(clientId: string, limit = 150): Promise<any[]> {
    // Get the client
    const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
    if (!client) {
      return [];
    }
    
    // For main accounts, aggregate all posts from all folders for this user
    const userId = client.userId;
    const allClientsForUser = await db.select().from(clients).where(eq(clients.userId, userId));
    
    // Get all client IDs (main account + all folders/location groups)
    const clientIds = allClientsForUser.map(c => c.id);
    
    let results;
    
    // If no client IDs found, just return posts for this client
    if (clientIds.length === 0) {
      results = await db.select({
        post: posts,
        jobItemPayload: jobItems.payload,
        locationName: clientLocations.name,
        locationAddress: clientLocations.address
      })
        .from(posts)
        .innerJoin(clientLocations, eq(posts.clientLocationId, clientLocations.id))
        .innerJoin(jobItems, eq(posts.jobItemId, jobItems.id))
        .where(
          and(
            eq(clientLocations.clientId, clientId),
            inArray(posts.status, ["active", "deleted"])
          )
        )
        .orderBy(desc(posts.createdAt))
        .limit(limit);
    } else {
      // Fetch posts for ALL clients belonging to this user
      results = await db.select({
        post: posts,
        jobItemPayload: jobItems.payload,
        locationName: clientLocations.name,
        locationAddress: clientLocations.address
      })
        .from(posts)
        .innerJoin(clientLocations, eq(posts.clientLocationId, clientLocations.id))
        .innerJoin(jobItems, eq(posts.jobItemId, jobItems.id))
        .where(
          and(
            inArray(clientLocations.clientId, clientIds),
            inArray(posts.status, ["active", "deleted"])
          )
        )
        .orderBy(desc(posts.createdAt))
        .limit(limit);
    }
    
    // Merge post data with job item payload to include CTA and media
    return results.map(r => {
      const postData = (r.jobItemPayload as any)?.postData || {};
      
      console.log('🔍 Post Data Debug:', {
        postId: r.post.id,
        hasPayload: !!r.jobItemPayload,
        payload: r.jobItemPayload,
        postData: postData,
        hasCTA: !!postData.callToAction,
        hasMedia: !!postData.media
      });
      
      return {
        ...r.post,
        callToAction: postData.callToAction || null,
        media: postData.media || null,
        topicType: postData.topicType || null,
        locationName: r.locationName,
        locationAddress: r.locationAddress
      };
    });
  }

  async createPost(insertPost: InsertPost): Promise<Post> {
    const [post] = await db.insert(posts).values(insertPost).returning();
    return post;
  }

  async deletePost(id: string, deletedBy?: string): Promise<void> {
    await db.update(posts)
      .set({ status: "deleted", deletedAt: new Date(), deletedBy: deletedBy || null })
      .where(eq(posts.id, id));
  }

  async getFoldersByUserId(userId: string): Promise<LocationFolder[]> {
    return await db.select().from(locationFolders).where(eq(locationFolders.userId, userId));
  }

  async getFolder(id: string): Promise<LocationFolder | undefined> {
    const [folder] = await db.select().from(locationFolders).where(eq(locationFolders.id, id));
    return folder || undefined;
  }

  async createFolder(insertFolder: InsertLocationFolder): Promise<LocationFolder> {
    const [folder] = await db.insert(locationFolders).values(insertFolder).returning();
    return folder;
  }

  async updateFolder(id: string, insertFolder: Partial<InsertLocationFolder>): Promise<LocationFolder> {
    const [folder] = await db.update(locationFolders)
      .set({ ...insertFolder, updatedAt: new Date() })
      .where(eq(locationFolders.id, id))
      .returning();
    return folder;
  }

  async deleteFolder(id: string): Promise<void> {
    await db.delete(locationFolderAssignments).where(eq(locationFolderAssignments.folderId, id));
    await db.delete(locationFolders).where(eq(locationFolders.id, id));
  }

  async getLocationsByFolderId(folderId: string): Promise<ClientLocation[]> {
    const results = await db.select({ location: clientLocations })
      .from(locationFolderAssignments)
      .innerJoin(clientLocations, eq(locationFolderAssignments.locationId, clientLocations.id))
      .where(eq(locationFolderAssignments.folderId, folderId));
    return results.map(r => r.location);
  }

  async assignLocationToFolder(folderId: string, locationId: string): Promise<LocationFolderAssignment> {
    const existing = await db.select()
      .from(locationFolderAssignments)
      .where(
        and(
          eq(locationFolderAssignments.folderId, folderId),
          eq(locationFolderAssignments.locationId, locationId)
        )
      );
    
    if (existing.length > 0) {
      return existing[0];
    }
    
    const [assignment] = await db.insert(locationFolderAssignments)
      .values({ folderId, locationId })
      .returning();
    return assignment;
  }

  async unassignLocationFromFolder(folderId: string, locationId: string): Promise<void> {
    await db.delete(locationFolderAssignments)
      .where(
        and(
          eq(locationFolderAssignments.folderId, folderId),
          eq(locationFolderAssignments.locationId, locationId)
        )
      );
  }

  // Location Tags
  async getTagsByUserId(userId: string): Promise<LocationTag[]> {
    return await db.select().from(locationTags).where(eq(locationTags.userId, userId));
  }

  async getTag(id: string): Promise<LocationTag | undefined> {
    const [tag] = await db.select().from(locationTags).where(eq(locationTags.id, id));
    return tag || undefined;
  }

  async createTag(insertTag: InsertLocationTag): Promise<LocationTag> {
    const [tag] = await db.insert(locationTags).values(insertTag).returning();
    return tag;
  }

  async updateTag(id: string, insertTag: Partial<InsertLocationTag>): Promise<LocationTag> {
    const [tag] = await db.update(locationTags)
      .set({ ...insertTag, updatedAt: new Date() })
      .where(eq(locationTags.id, id))
      .returning();
    return tag;
  }

  async deleteTag(id: string): Promise<void> {
    await db.delete(locationTagAssignments).where(eq(locationTagAssignments.tagId, id));
    await db.delete(locationTags).where(eq(locationTags.id, id));
  }

  async getLocationsByTagId(tagId: string): Promise<ClientLocation[]> {
    const results = await db.select({ location: clientLocations })
      .from(locationTagAssignments)
      .innerJoin(clientLocations, eq(locationTagAssignments.locationId, clientLocations.id))
      .where(eq(locationTagAssignments.tagId, tagId));
    return results.map(r => r.location);
  }

  async getTagsByLocationId(locationId: string): Promise<LocationTag[]> {
    const results = await db.select({ tag: locationTags })
      .from(locationTagAssignments)
      .innerJoin(locationTags, eq(locationTagAssignments.tagId, locationTags.id))
      .where(eq(locationTagAssignments.locationId, locationId));
    return results.map(r => r.tag);
  }

  async assignTagToLocation(tagId: string, locationId: string): Promise<LocationTagAssignment> {
    const existing = await db.select()
      .from(locationTagAssignments)
      .where(
        and(
          eq(locationTagAssignments.tagId, tagId),
          eq(locationTagAssignments.locationId, locationId)
        )
      );
    
    if (existing.length > 0) {
      return existing[0];
    }
    
    const [assignment] = await db.insert(locationTagAssignments)
      .values({ tagId, locationId })
      .returning();
    return assignment;
  }

  async unassignTagFromLocation(tagId: string, locationId: string): Promise<void> {
    await db.delete(locationTagAssignments)
      .where(
        and(
          eq(locationTagAssignments.tagId, tagId),
          eq(locationTagAssignments.locationId, locationId)
        )
      );
  }

  // Local Users
  async getLocalUsersByUserId(userId: string): Promise<LocalUser[]> {
    return db.select().from(localUsers)
      .where(and(eq(localUsers.userId, userId), eq(localUsers.isActive, true)))
      .orderBy(localUsers.name);
  }

  async getLocalUser(id: string): Promise<LocalUser | undefined> {
    const [user] = await db.select().from(localUsers).where(eq(localUsers.id, id));
    return user || undefined;
  }

  async createLocalUser(insertLocalUser: InsertLocalUser): Promise<LocalUser> {
    const [user] = await db.insert(localUsers).values(insertLocalUser).returning();
    return user;
  }

  async updateLocalUser(id: string, insertLocalUser: Partial<InsertLocalUser>): Promise<LocalUser> {
    const [user] = await db.update(localUsers)
      .set({ ...insertLocalUser, updatedAt: new Date() })
      .where(eq(localUsers.id, id))
      .returning();
    return user;
  }

  async deleteLocalUser(id: string): Promise<void> {
    await db.update(localUsers)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(localUsers.id, id));
  }

  async createInviteCode(userId: string, code: string, createdByLocalUserId?: string): Promise<InviteCode> {
    const [row] = await db.insert(inviteCodes).values({
      userId,
      code,
      createdByLocalUserId: createdByLocalUserId ?? null,
    }).returning();
    return row;
  }

  async listInviteCodes(userId: string): Promise<InviteCode[]> {
    return db.select().from(inviteCodes)
      .where(eq(inviteCodes.userId, userId))
      .orderBy(desc(inviteCodes.createdAt));
  }

  async getInviteCodeByCode(userId: string, code: string): Promise<InviteCode | undefined> {
    const [row] = await db.select().from(inviteCodes)
      .where(and(eq(inviteCodes.userId, userId), eq(inviteCodes.code, code)));
    return row;
  }

  async markInviteCodeUsed(id: string, usedByLocalUserId: string): Promise<void> {
    await db.update(inviteCodes)
      .set({ usedByLocalUserId, usedAt: new Date(), isActive: false })
      .where(eq(inviteCodes.id, id));
  }

  async revokeInviteCode(id: string): Promise<void> {
    await db.update(inviteCodes)
      .set({ isActive: false })
      .where(eq(inviteCodes.id, id));
  }

  async getActivePostsByJobId(jobId: string): Promise<Post[]> {
    return await db.select()
      .from(posts)
      .where(and(eq(posts.jobId, jobId), eq(posts.status, "active")));
  }

  async deleteJob(id: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(jobItems).where(eq(jobItems.jobId, id));
      await tx.delete(jobs).where(eq(jobs.id, id));
    });
  }

  // Review Email Groups
  async getReviewEmailGroupsByUserId(userId: string): Promise<ReviewEmailGroup[]> {
    return await db.select().from(reviewEmailGroups).where(eq(reviewEmailGroups.userId, userId));
  }

  async getReviewEmailGroup(id: string): Promise<ReviewEmailGroup | undefined> {
    const [group] = await db.select().from(reviewEmailGroups).where(eq(reviewEmailGroups.id, id));
    return group || undefined;
  }

  async createReviewEmailGroup(group: InsertReviewEmailGroup): Promise<ReviewEmailGroup> {
    const [created] = await db.insert(reviewEmailGroups).values(group).returning();
    return created;
  }

  async updateReviewEmailGroup(id: string, group: Partial<InsertReviewEmailGroup>): Promise<ReviewEmailGroup> {
    const [updated] = await db.update(reviewEmailGroups)
      .set({ ...group, updatedAt: new Date() })
      .where(eq(reviewEmailGroups.id, id))
      .returning();
    return updated;
  }

  async deleteReviewEmailGroup(id: string): Promise<void> {
    await db.delete(reviewEmailGroups).where(eq(reviewEmailGroups.id, id));
  }

  async getReviewEmailGroupLocations(groupId: string): Promise<ReviewEmailGroupLocation[]> {
    return await db.select().from(reviewEmailGroupLocations).where(eq(reviewEmailGroupLocations.groupId, groupId));
  }

  async setReviewEmailGroupLocations(groupId: string, locationIds: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(reviewEmailGroupLocations).where(eq(reviewEmailGroupLocations.groupId, groupId));
      if (locationIds.length > 0) {
        await tx.insert(reviewEmailGroupLocations).values(
          locationIds.map(locationId => ({ groupId, locationId }))
        );
      }
    });
  }

  async getEnabledReviewEmailGroups(): Promise<ReviewEmailGroup[]> {
    return await db.select().from(reviewEmailGroups).where(eq(reviewEmailGroups.isEnabled, true));
  }

  // Apple Locations
  async getAppleLocationsByUserId(userId: string): Promise<AppleLocation[]> {
    return await db.select().from(appleLocations).where(eq(appleLocations.userId, userId));
  }

  async getAppleLocation(id: string): Promise<AppleLocation | undefined> {
    const [location] = await db.select().from(appleLocations).where(eq(appleLocations.id, id));
    return location || undefined;
  }

  async createAppleLocation(location: InsertAppleLocation): Promise<AppleLocation> {
    const [created] = await db.insert(appleLocations).values(location).returning();
    return created;
  }

  async updateAppleLocation(id: string, location: Partial<InsertAppleLocation>): Promise<AppleLocation> {
    const [updated] = await db.update(appleLocations)
      .set({ ...location, updatedAt: new Date() })
      .where(eq(appleLocations.id, id))
      .returning();
    return updated;
  }

  async deleteAppleLocation(id: string): Promise<void> {
    await db.delete(appleLocations).where(eq(appleLocations.id, id));
  }

  async bulkUpdateAppleLocations(ids: string[], updates: Partial<InsertAppleLocation>): Promise<AppleLocation[]> {
    if (ids.length === 0) return [];
    const updated = await db.update(appleLocations)
      .set({ ...updates, updatedAt: new Date() })
      .where(inArray(appleLocations.id, ids))
      .returning();
    return updated;
  }

  async upsertLocationPerformanceBatch(records: InsertLocationPerformanceData[]): Promise<void> {
    if (records.length === 0) return;
    const chunkSize = 100;
    for (let i = 0; i < records.length; i += chunkSize) {
      const chunk = records.slice(i, i + chunkSize);
      await db.insert(locationPerformanceData)
        .values(chunk)
        .onConflictDoUpdate({
          target: [locationPerformanceData.locationId, locationPerformanceData.date],
          set: {
            callClicks: sql`excluded.call_clicks`,
            websiteClicks: sql`excluded.website_clicks`,
            directionRequests: sql`excluded.direction_requests`,
            impressions: sql`excluded.impressions`,
            fetchedAt: sql`now()`,
          },
        });
    }
  }

  async getLocationPerformanceRange(locationId: string, startDate: string, endDate: string): Promise<LocationPerformanceData[]> {
    return await db.select()
      .from(locationPerformanceData)
      .where(
        and(
          eq(locationPerformanceData.locationId, locationId),
          gte(locationPerformanceData.date, startDate),
          lte(locationPerformanceData.date, endDate),
        )
      )
      .orderBy(asc(locationPerformanceData.date));
  }

  async getLocationPerformanceEarliestDate(locationId: string): Promise<string | null> {
    const [row] = await db.select({ date: locationPerformanceData.date })
      .from(locationPerformanceData)
      .where(eq(locationPerformanceData.locationId, locationId))
      .orderBy(asc(locationPerformanceData.date))
      .limit(1);
    return row?.date ?? null;
  }

  async getClientPerformanceDaily(
    clientId: string,
    startDate: string,
    endDate: string,
  ): Promise<Array<{ date: string; callClicks: number; websiteClicks: number; directionRequests: number; impressions: number }>> {
    const rows = await db
      .select({
        date: locationPerformanceData.date,
        callClicks: sql<number>`sum(${locationPerformanceData.callClicks})`,
        websiteClicks: sql<number>`sum(${locationPerformanceData.websiteClicks})`,
        directionRequests: sql<number>`sum(${locationPerformanceData.directionRequests})`,
        impressions: sql<number>`sum(${locationPerformanceData.impressions})`,
      })
      .from(locationPerformanceData)
      .innerJoin(
        clientLocations,
        eq(clientLocations.id, locationPerformanceData.locationId),
      )
      .where(
        and(
          eq(clientLocations.clientId, clientId),
          gte(locationPerformanceData.date, startDate),
          lte(locationPerformanceData.date, endDate),
        ),
      )
      .groupBy(locationPerformanceData.date)
      .orderBy(asc(locationPerformanceData.date));

    return rows.map((r) => ({
      date: r.date,
      callClicks: Number(r.callClicks ?? 0),
      websiteClicks: Number(r.websiteClicks ?? 0),
      directionRequests: Number(r.directionRequests ?? 0),
      impressions: Number(r.impressions ?? 0),
    }));
  }

  async getDismissedDashboardItems(): Promise<DismissedDashboardItem[]> {
    return await db.select().from(dismissedDashboardItems);
  }

  async addDismissedDashboardItem(itemType: string, itemId: string, userId?: string | null): Promise<void> {
    await db
      .insert(dismissedDashboardItems)
      .values({ itemType, itemId, dismissedByUserId: userId ?? null })
      .onConflictDoNothing();
  }
}

export const storage = new DatabaseStorage();
