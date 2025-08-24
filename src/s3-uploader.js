const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const path = require('path');

class S3Uploader {
  constructor(s3Config, projectName, logger) {
    this.logger = logger;
    this.projectName = projectName;
    
    const clientConfig = {
      region: s3Config.region,
      credentials: {
        accessKeyId: s3Config.accessKeyId,
        secretAccessKey: s3Config.secretAccessKey
      }
    };
    
    if (s3Config.endpoint) {
      clientConfig.endpoint = s3Config.endpoint;
      clientConfig.forcePathStyle = s3Config.forcePathStyle !== false;
    }
    
    this.s3Client = new S3Client(clientConfig);
    this.bucket = s3Config.bucket;
  }

  async uploadFile(filePath, s3Key) {
    const fileStream = fs.createReadStream(filePath);
    const fileName = path.basename(filePath);
    
    this.logger.info(`Uploading ${fileName} to S3...`);
    
    const uploadParams = {
      Bucket: this.bucket,
      Key: s3Key,
      Body: fileStream,
      ServerSideEncryption: 'AES256'
    };
    
    try {
      // Use the multipart upload utility for better performance
      const upload = new Upload({
        client: this.s3Client,
        params: uploadParams
      });
      
      const result = await upload.done();
      
      this.logger.info(`Successfully uploaded ${fileName} to ${result.Location}`);
      
      return {
        fileName,
        s3Key,
        location: result.Location,
        size: fs.statSync(filePath).size
      };
    } catch (error) {
      throw new Error(`Failed to upload ${fileName}: ${error.message}`);
    }
  }

  async uploadBackups(backupFiles, timestamp) {
    const results = [];
    
    for (const backup of backupFiles) {
      const s3Key = `${this.projectName}/${backup.name}/${path.basename(backup.path)}`;
      
      try {
        const result = await this.uploadFile(backup.path, s3Key);
        results.push(result);
      } catch (error) {
        this.logger.error(`Failed to upload backup ${backup.name}: ${error.message}`);
        throw error;
      }
    }
    
    return results;
  }

  async listBackups(prefix = '') {
    try {
      // Default to project-scoped listing if no prefix provided
      const searchPrefix = prefix || `${this.projectName}/`;
      
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: searchPrefix
      });
      
      const result = await this.s3Client.send(command);
      return result.Contents || [];
    } catch (error) {
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }

  async deleteBackup(s3Key) {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: s3Key
      });
      
      await this.s3Client.send(command);
      this.logger.info(`Deleted backup: ${s3Key}`);
    } catch (error) {
      throw new Error(`Failed to delete backup ${s3Key}: ${error.message}`);
    }
  }

  async cleanupOldBackups(retentionConfig) {
    const { daily = 7, weekly = 4, monthly = 12 } = retentionConfig;
    
    try {
      // Only clean up backups within this project
      const backups = await this.listBackups(`${this.projectName}/`);
      const now = new Date();
      let deletedCount = 0;
      
      for (const backup of backups) {
        const backupDate = new Date(backup.LastModified);
        const daysDiff = Math.floor((now - backupDate) / (1000 * 60 * 60 * 24));
        
        let shouldDelete = false;
        
        if (daysDiff > daily && daysDiff <= 28) {
          const weeksDiff = Math.floor(daysDiff / 7);
          if (weeksDiff > weekly) {
            shouldDelete = true;
          }
        } else if (daysDiff > 28) {
          const monthsDiff = Math.floor(daysDiff / 30);
          if (monthsDiff > monthly) {
            shouldDelete = true;
          }
        }
        
        if (shouldDelete) {
          await this.deleteBackup(backup.Key);
          deletedCount++;
        }
      }
      
      if (deletedCount > 0) {
        this.logger.info(`Cleaned up ${deletedCount} old backup(s) for project: ${this.projectName}`);
      }
      
      return { deletedCount };
    } catch (error) {
      this.logger.error(`Failed to cleanup old backups: ${error.message}`);
      throw error;
    }
  }
}

module.exports = S3Uploader;