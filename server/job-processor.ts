// Job processor for GBP bulk operations
import { storage } from "./storage";
import type { Job, JobItem } from "@shared/schema";
import { EventEmitter } from "events";

// Progress event emitter for real-time updates
export const progressEmitter = new EventEmitter();

export interface JobProgress {
  jobId: string;
  status: string;
  totalItems: number;
  successCount: number;
  errorCount: number;
  processedCount: number;
  percent: number;
  step: number; // 1: Queued, 2: Processing, 3: Finalizing
}

export interface JobProcessorOptions {
  rateLimit: number; // requests per second
  batchSize: number;
  maxRetries: number;
  retryDelay: number; // base delay in ms
}

export const defaultOptions: JobProcessorOptions = {
  rateLimit: 3, // 3 requests per second
  batchSize: 15,
  maxRetries: 3,
  retryDelay: 2000, // 2 seconds base delay
};

export async function createJob(data: any): Promise<Job> {
  // Create job with provided data
  console.log("Creating job:", data);
  
  // For MVP, this is a stub - in production this would:
  // 1. Parse CSV data
  // 2. Validate against GBP API schemas
  // 3. Create job items for each location
  // 4. Queue for processing
  
  return data as Job;
}

function emitProgress(jobId: string, job: Job, successCount: number, errorCount: number, processedCount: number) {
  const progress: JobProgress = {
    jobId,
    status: job.status,
    totalItems: job.totalItems,
    successCount,
    errorCount,
    processedCount,
    percent: job.totalItems > 0 ? Math.round((processedCount / job.totalItems) * 100) : 0,
    step: job.status === "queued" ? 1 : job.status === "running" ? 2 : 3
  };
  
  progressEmitter.emit("progress", progress);
  console.log(`Progress update for job ${jobId}: ${progress.percent}% (${processedCount}/${job.totalItems})`);
}

export async function processJob(jobId: string, options: JobProcessorOptions = defaultOptions): Promise<void> {
  console.log(`Processing job ${jobId} with options:`, options);
  
  try {
    const job = await storage.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    // Start processing - emit initial progress
    await storage.updateJob(jobId, { 
      status: "running",
      startedAt: new Date(),
    });
    
    const updatedJob = await storage.getJob(jobId);
    emitProgress(jobId, updatedJob!, 0, 0, 0);
    
    const items = await storage.getJobItems(jobId);
    
    // Process items in batches with rate limiting
    const batches = chunkArray(items, options.batchSize);
    let totalProcessed = 0;
    
    for (const batch of batches) {
      await processBatch(batch, job, options, jobId);
      
      // Update progress after each batch
      totalProcessed += batch.length;
      const updatedItems = await storage.getJobItems(jobId);
      const successCount = updatedItems.filter(item => item.status === "success").length;
      const errorCount = updatedItems.filter(item => item.status === "failed").length;
      
      await storage.updateJob(jobId, {
        successCount,
        errorCount,
        processedCount: totalProcessed
      });
      
      const currentJob = await storage.getJob(jobId);
      emitProgress(jobId, currentJob!, successCount, errorCount, totalProcessed);
      
      // Rate limiting delay between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await delay(1000 / options.rateLimit);
      }
    }
    
    // Finalize job
    const updatedItems = await storage.getJobItems(jobId);
    const successCount = updatedItems.filter(item => item.status === "success").length;
    const errorCount = updatedItems.filter(item => item.status === "failed").length;
    
    const finalStatus = errorCount === 0 ? "success" : 
                       successCount > 0 ? "partial" : "failed";
    
    await storage.updateJob(jobId, {
      status: finalStatus,
      successCount,
      errorCount,
      processedCount: totalProcessed,
      completedAt: new Date()
    });
    
    // Emit final progress
    const finalJob = await storage.getJob(jobId);
    emitProgress(jobId, finalJob!, successCount, errorCount, totalProcessed);
    
    console.log(`Job ${jobId} completed with status: ${finalStatus}`);
    
  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    await storage.updateJob(jobId, { 
      status: "failed",
      completedAt: new Date()
    });
  }
}

async function processBatch(items: JobItem[], job: Job, options: JobProcessorOptions, jobId: string): Promise<void> {
  const promises = items.map(item => processJobItem(item, job, options));
  await Promise.allSettled(promises);
}

async function processJobItem(item: JobItem, job: Job, options: JobProcessorOptions, retryCount = 0): Promise<void> {
  try {
    // For MVP, simulate processing
    if (job.isDryRun) {
      // Dry run - just validate and preview
      await simulateDryRun(item, job);
    } else {
      // Execute - make actual API calls to GBP
      await simulateExecution(item, job);
    }
    
    await storage.updateJobItem(item.id, { status: "success" });
    
  } catch (error) {
    console.error(`Error processing job item ${item.id}:`, error);
    
    if (retryCount < options.maxRetries) {
      // Exponential backoff retry
      const delay = options.retryDelay * Math.pow(2, retryCount);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      return processJobItem(item, job, options, retryCount + 1);
    } else {
      await storage.updateJobItem(item.id, { 
        status: "failed", 
        errorText: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
}

async function simulateDryRun(item: JobItem, job: Job): Promise<void> {
  // Simulate validation and preview generation
  await delay(100 + Math.random() * 200); // 100-300ms
  
  if (Math.random() < 0.05) { // 5% failure rate for simulation
    throw new Error("Validation failed - invalid data format");
  }
}

async function simulateExecution(item: JobItem, job: Job): Promise<void> {
  // Make real Google Business Profile API calls
  try {
    // Import the Google OAuth service
    const { googleOAuthAuth } = await import("./google-service-auth");
    
    // Load the shared Google connection if it isn't in memory yet.
    if (!(await googleOAuthAuth.ensureAuthenticated())) {
      const authError = "No shared Google connection. Someone needs to connect Google Business Profile once (any logged-in user) and it will apply to everyone.";
      console.error(`🔒 Authentication error for job item ${item.id}:`, authError);
      throw new Error(authError);
    }

    // Get the GBP location name directly from job item payload
    const itemPayload = item.payload as any;
    const gbpLocationName = itemPayload?.gbpLocationName;
    const locationTitle = itemPayload?.locationTitle || 'Unknown Location';
    
    if (!gbpLocationName) {
      throw new Error(`Google Business Profile location name not found in job item payload for item: ${item.id}`);
    }

    console.log(`🔄 Processing ${job.type} update for location: ${locationTitle}`);

    // Handle different job types
    if (job.type === "hours") {
      // Get hours data from job item payload or job payload
      const hoursData = itemPayload?.hoursData || (job.payload as any)?.hoursData;
      if (!hoursData) {
        throw new Error("Hours data not found in job item or job payload");
      }
      
      await googleOAuthAuth.updateHours(gbpLocationName, hoursData);
      console.log(`✅ Successfully updated hours for location: ${locationTitle}`);

      // Stamp activity timestamp on the location
      await storage.updateLocation(item.clientLocationId, { lastHoursUpdateAt: new Date() });
    } else if (job.type === "posts") {
      // Get post data from job item payload
      const postData = itemPayload?.postData;
      if (!postData) {
        throw new Error("Post data not found in job item payload");
      }
      
      const postResult = await googleOAuthAuth.createPost(gbpLocationName, postData);
      console.log(`✅ Successfully created post for location: ${locationTitle}`);
      
      // Store the post ID in the database
      if (postResult.success && postResult.name) {
        await storage.createPost({
          jobId: job.id,
          jobItemId: item.id,
          clientLocationId: item.clientLocationId,
          gbpPostName: postResult.name,
          summary: postData.summary,
          status: "active"
        });
        console.log(`📝 Stored post record: ${postResult.name}`);
      }

      // Stamp activity timestamp on the location
      await storage.updateLocation(item.clientLocationId, { lastPostAt: new Date() });
    } else if (job.type === "photo") {
      // Stamp photo activity timestamp
      await storage.updateLocation(item.clientLocationId, { lastPhotoAt: new Date() });
    } else {
      throw new Error(`Unsupported job type: ${job.type}`);
    }

  } catch (error) {
    console.error(`❌ Error executing job item ${item.id}:`, error);
    throw error;
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}