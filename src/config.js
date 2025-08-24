const Joi = require('joi');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Security utilities
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  // Remove potentially dangerous characters
  return str.replace(/[;&|`$(){}\[\]<>"'\\]/g, '');
};

const sanitizeFilePath = (filePath) => {
  if (typeof filePath !== 'string') return filePath;
  // Resolve and normalize path to prevent traversal
  const resolved = path.resolve(filePath);
  // Ensure the path doesn't contain traversal patterns
  if (resolved.includes('..') || filePath.includes('..')) {
    throw new Error('Path traversal detected in file path');
  }
  return resolved;
};

const validateCredential = (credential) => {
  if (typeof credential !== 'string' || credential.length < 1) {
    throw new Error('Invalid credential format');
  }
  // Check for common injection patterns
  const dangerousPatterns = [';', '|', '&', '`', '$', '(', ')', '{', '}', '<', '>', '"', "'"];
  if (dangerousPatterns.some(pattern => credential.includes(pattern))) {
    throw new Error('Credential contains potentially dangerous characters');
  }
  return true;
};

const configSchema = Joi.object({
  project: Joi.object({
    name: Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).min(1).max(50).required()
  }).required(),
  
  s3: Joi.object({
    region: Joi.string().pattern(/^[a-z0-9-]+$/).required(),
    bucket: Joi.string().pattern(/^[a-z0-9.-]+$/).min(3).max(63).required(),
    accessKeyId: Joi.string().required(),
    secretAccessKey: Joi.string().required(),
    endpoint: Joi.string().uri().optional(),
    forcePathStyle: Joi.boolean().default(false),
    signatureVersion: Joi.string().valid('v2', 'v4').default('v4')
  }).required(),
  
  directories: Joi.array().items(
    Joi.object({
      name: Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).min(1).max(100).required(),
      path: Joi.string().min(1).max(1000).required(),
      exclude: Joi.array().items(
        Joi.string().pattern(/^[a-zA-Z0-9_.*/-]+$/).max(200)
      ).default([])
    })
  ).default([]),
  
  databases: Joi.array().items(
    Joi.object({
      name: Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).min(1).max(100).required(),
      type: Joi.string().valid('mysql', 'mariadb').required(),
      host: Joi.string().hostname().required(),
      port: Joi.number().port().default(3306),
      username: Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).min(1).max(64).required(),
      password: Joi.string().allow('').default(''),  // Allow empty password for local setups
      database: Joi.string().pattern(/^[a-zA-Z0-9_-]+$/).min(1).max(64).required(),
      // Optional MySQL/MariaDB config file path for additional security
      configFile: Joi.string().optional(),
      // Optional charset for proper encoding
      charset: Joi.string().default('utf8mb4')
    })
  ).default([]),
  
  backup: Joi.object({
    schedule: Joi.string().pattern(/^[0-9*\s/-]+$/).optional(),
    retention: Joi.object({
      daily: Joi.number().integer().min(0).max(365).default(7),
      weekly: Joi.number().integer().min(0).max(52).default(4),
      monthly: Joi.number().integer().min(0).max(60).default(12)
    }).default({}),
    compression: Joi.boolean().default(true),
    timestamp: Joi.boolean().default(true),
    // New security options
    tempDir: Joi.string().optional(),
    filePermissions: Joi.string().pattern(/^[0-7]{3}$/).default('600')
  }).default({})
});

function loadConfig(configPath) {
  try {
    // Validate config file path
    const safePath = sanitizeFilePath(configPath);
    
    // Security checks for config file
    performConfigSecurityChecks(safePath);
    
    const configData = fs.readFileSync(safePath, 'utf8');
    const config = JSON.parse(configData);
    
    // Validate and sanitize
    const { error, value } = configSchema.validate(config, { 
      abortEarly: false,
      stripUnknown: true 
    });
    
    if (error) {
      const details = error.details.map(d => d.message).join(', ');
      throw new Error(`Configuration validation error: ${details}`);
    }
    
    // Additional security validation
    validateSecurityConstraints(value);
    
    return value;
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`Configuration file not found: ${configPath}`);
    }
    throw err;
  }
}

function performConfigSecurityChecks(configPath) {
  // Check file permissions
  const stats = fs.statSync(configPath);
  const mode = stats.mode & parseInt('777', 8);
  
  if (mode > parseInt('600', 8)) {
    console.warn(`\n⚠️  WARNING: Config file has overly permissive permissions (${mode.toString(8)})`);
    console.warn(`   Run: chmod 600 ${configPath}`);
    console.warn(`   This file contains sensitive credentials!\n`);
  }
  
  // Check if we're in a git repository
  const gitDir = findGitDirectory(configPath);
  if (gitDir) {
    checkGitIgnore(configPath, gitDir);
  }
}

function findGitDirectory(startPath) {
  let currentDir = path.dirname(startPath);
  
  while (currentDir !== path.dirname(currentDir)) {
    const gitPath = path.join(currentDir, '.git');
    if (fs.existsSync(gitPath)) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  
  return null;
}

function checkGitIgnore(configPath, gitDir) {
  const gitignorePath = path.join(gitDir, '.gitignore');
  const configRelativePath = path.relative(gitDir, configPath);
  
  let gitignoreExists = fs.existsSync(gitignorePath);
  let isIgnored = false;
  
  if (gitignoreExists) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    const lines = gitignoreContent.split('\n').map(line => line.trim());
    
    // Check if config file or pattern is ignored
    isIgnored = lines.some(line => {
      if (!line || line.startsWith('#')) return false;
      
      // Exact match
      if (line === configRelativePath || line === path.basename(configPath)) return true;
      
      // Pattern match (basic)
      if (line.includes('*') && configPath.includes(line.replace('*', ''))) return true;
      
      return false;
    });
  }
  
  if (!isIgnored) {
    console.warn(`\n🚨 SECURITY ALERT: Config file may not be ignored by git!`);
    console.warn(`   File: ${configRelativePath}`);
    console.warn(`   This file contains sensitive credentials and should not be committed.`);
    console.warn(`\n   Add to .gitignore:`);
    console.warn(`   echo "${path.basename(configPath)}" >> .gitignore`);
    console.warn(`   or`);
    console.warn(`   echo "${configRelativePath}" >> .gitignore\n`);
    
    // Create .gitignore if it doesn't exist
    if (!gitignoreExists) {
      console.warn(`   Creating .gitignore file...`);
      fs.writeFileSync(gitignorePath, `# Backup configuration with credentials\n${path.basename(configPath)}\n`);
      console.warn(`   ✅ Added ${path.basename(configPath)} to .gitignore\n`);
    }
  }
}

// Environment variable support is now optional - credentials primarily from config

function validateSecurityConstraints(config) {
  // Validate project name
  if (!config.project || !config.project.name) {
    throw new Error('Project name must be provided in configuration');
  }
  
  // Validate S3 credentials are present
  if (!config.s3.accessKeyId || !config.s3.secretAccessKey) {
    throw new Error('S3 credentials must be provided in configuration file');
  }
  
  validateCredential(config.s3.accessKeyId);
  validateCredential(config.s3.secretAccessKey);
  
  // Validate database configurations
  config.databases.forEach((db, index) => {
    // Only validate non-empty passwords
    if (db.password && db.password.length > 0) {
      validateCredential(db.password);
    }
    
    // Validate file paths
    if (db.configFile) {
      sanitizeFilePath(db.configFile);
    }
    
    // Validate database type
    if (!['mysql', 'mariadb'].includes(db.type)) {
      throw new Error(`Unsupported database type: ${db.type}. Only MySQL and MariaDB are supported.`);
    }
    
    // Warn about empty passwords in production
    if (!db.password || db.password.length === 0) {
      console.warn(`⚠️  WARNING: Database ${db.name} has no password. This is only recommended for local development.`);
    }
  });
  
  // Validate directory paths
  config.directories.forEach(dir => {
    dir.path = sanitizeFilePath(dir.path);
    
    // Validate exclude patterns
    dir.exclude.forEach(pattern => {
      if (typeof pattern !== 'string' || pattern.length > 200) {
        throw new Error(`Invalid exclude pattern: ${pattern}`);
      }
    });
  });
}

module.exports = { 
  loadConfig, 
  sanitizeString, 
  sanitizeFilePath, 
  validateCredential 
};