import validator from 'validator';
import { config } from '../config';

export interface URLValidationResult {
  isValid: boolean;
  url?: string;
  error?: string;
  protocol?: string;
  hostname?: string;
}

export interface HealthCheckResult {
  isHealthy: boolean;
  responseTime?: number;
  status?: number;
  error?: string;
}

export class URLValidator {
  private static instance: URLValidator;
  private healthCache: Map<string, { result: HealthCheckResult; timestamp: number }> = new Map();
  private readonly healthCacheTTL = 30000; // 30 seconds

  private constructor() {}

  public static getInstance(): URLValidator {
    if (!URLValidator.instance) {
      URLValidator.instance = new URLValidator();
    }
    return URLValidator.instance;
  }

  /**
   * Validates a URL using validator.js with production security settings
   */
  public validateURL(urlString: string): URLValidationResult {
    try {
      // Handle empty URLs
      if (!urlString || !urlString.trim()) {
        return { isValid: false, error: 'URL cannot be empty' };
      }

      let normalizedUrl = urlString.trim();

      // Handle relative URLs
      if (normalizedUrl.startsWith('/')) {
        const frontendURL = new URL(config.frontendOrigin);
        normalizedUrl = `${frontendURL.protocol}//${frontendURL.host}${normalizedUrl}`;
      } else if (!normalizedUrl.includes('://')) {
        // Add protocol if missing
        const protocol = config.isProduction ? 'https' : 'http';
        normalizedUrl = `${protocol}://${normalizedUrl}`;
      }

      // Basic URL validation using validator.js
      const validatorOptions = {
        protocols: ['http', 'https'],
        require_protocol: true,
        require_host: true,
        require_valid_protocol: true,
        allow_underscores: false,
        host_whitelist: config.isProduction ? this.getHostWhitelist() : undefined,
        disallow_auth: true // Prevent URLs with username:password@
      };

      if (!validator.isURL(normalizedUrl, validatorOptions)) {
        return {
          isValid: false,
          error: 'URL format is invalid or contains disallowed patterns'
        };
      }

      // Parse the validated URL
      const parsedURL = new URL(normalizedUrl);

      // Additional security checks for production
      if (config.isProduction) {
        const securityCheck = this.performProductionSecurityChecks(parsedURL);
        if (!securityCheck.isValid) {
          return securityCheck;
        }
      }

      return {
        isValid: true,
        url: parsedURL.toString(),
        protocol: parsedURL.protocol,
        hostname: parsedURL.hostname
      };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Invalid URL format'
      };
    }
  }

  /**
   * Validates email addresses (useful for OAuth flows)
   */
  public validateEmail(email: string): boolean {
    return validator.isEmail(email, {
      allow_display_name: false,
      require_display_name: false,
      allow_utf8_local_part: false,
      require_tld: true,
      blacklisted_chars: '',
      ignore_max_length: false,
      host_blacklist: [] // Add suspicious domains if needed
    });
  }

  /**
   * Validates domain names
   */
  public validateDomain(domain: string): boolean {
    return validator.isFQDN(domain, {
      require_tld: true,
      allow_underscores: false,
      allow_trailing_dot: false,
      allow_numeric_tld: false,
      allow_wildcard: false
    });
  }

  /**
   * Performs health check on a validated URL with circuit breaker pattern
   */
  public async healthCheck(urlString: string, timeoutMs: number = 5000): Promise<HealthCheckResult> {
    const validation = this.validateURL(urlString);
    if (!validation.isValid) {
      return {
        isHealthy: false,
        error: `URL validation failed: ${validation.error}`
      };
    }

    const url = validation.url!;
    
    // Check cache first (circuit breaker pattern)
    const cached = this.healthCache.get(url);
    if (cached && Date.now() - cached.timestamp < this.healthCacheTTL) {
      return cached.result;
    }

    const startTime = Date.now();
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${url}/health`, {
        method: 'HEAD', // More efficient than GET
        signal: controller.signal,
        headers: {
          'User-Agent': 'Eclipsn-Gateway-HealthCheck/1.0',
          'Accept': 'application/json'
        },
        // Security: Don't follow redirects automatically
        redirect: 'manual'
      });

      clearTimeout(timeoutId);
      const responseTime = Date.now() - startTime;

      const result: HealthCheckResult = {
        isHealthy: response.ok || response.status === 405, // Some endpoints don't support HEAD
        responseTime,
        status: response.status,
        error: response.ok ? undefined : `HTTP ${response.status}`
      };

      // Cache successful results longer
      const cacheMultiplier = result.isHealthy ? 1 : 0.3;
      this.healthCache.set(url, { 
        result, 
        timestamp: Date.now() - (this.healthCacheTTL * (1 - cacheMultiplier))
      });

      return result;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      const result: HealthCheckResult = {
        isHealthy: false,
        responseTime,
        error: errorMessage
      };

      // Cache failed results for shorter time
      this.healthCache.set(url, { 
        result, 
        timestamp: Date.now() - (this.healthCacheTTL * 0.7) 
      });

      return result;
    }
  }

  /**
   * Builds and validates gateway URLs with intelligent fallback
   */
  public buildGatewayURL(path: string): { url: string; source: 'direct' | 'proxy' | 'fallback' } {
    const cleanPath = path.replace(/^\/+/, ''); // Remove leading slashes

    // Try direct gateway URL first
    const gatewayURL = process.env.NEXT_PUBLIC_GATEWAY_URL;
    if (gatewayURL && gatewayURL !== '/api') {
      const fullUrl = `${gatewayURL.replace(/\/+$/, '')}/${cleanPath}`;
      const validation = this.validateURL(fullUrl);
      if (validation.isValid) {
        return { url: validation.url!, source: 'direct' };
      }
    }

    // Fall back to Next.js proxy
    if (!gatewayURL || gatewayURL === '/api') {
      return { url: `/api/${cleanPath}`, source: 'proxy' };
    }

    // Emergency fallback
    const fallbackURL = `http://localhost:4000/api/${cleanPath}`;
    console.warn(`⚠️  Gateway URL validation failed, using fallback: ${fallbackURL}`);
    return { url: fallbackURL, source: 'fallback' };
  }

  /**
   * Sanitizes URL parameters to prevent injection
   */
  public sanitizeURLParams(params: Record<string, any>): Record<string, string> {
    const sanitized: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      
      const stringValue = String(value);
      const sanitizedKey = validator.escape(key);
      const sanitizedValue = validator.escape(stringValue);
      
      // Additional checks for common injection patterns
      if (!this.containsMaliciousPatterns(sanitizedValue)) {
        sanitized[sanitizedKey] = sanitizedValue;
      }
    }
    
    return sanitized;
  }

  /**
   * Clears health cache (useful for testing or manual refresh)
   */
  public clearHealthCache(): void {
    this.healthCache.clear();
  }

  private getHostWhitelist(): string[] {
    const allowedHosts = new Set<string>();
    
    // Add configured origins
    config.allowedOrigins.forEach(origin => {
      try {
        allowedHosts.add(new URL(origin).hostname);
      } catch {
        // Skip invalid origins
      }
    });
    
    // Add service URLs
    try {
      allowedHosts.add(new URL(config.brainServiceUrl).hostname);
    } catch {}
    
    try {
      allowedHosts.add(new URL(config.googleRedirectUri).hostname);
    } catch {}
    
    // Add localhost variants for development
    if (!config.isProduction) {
      allowedHosts.add('localhost');
      allowedHosts.add('127.0.0.1');
      allowedHosts.add('::1');
    }
    
    return Array.from(allowedHosts);
  }

  private performProductionSecurityChecks(url: URL): URLValidationResult {
    // Check for private IP ranges using validator.js
    if (validator.isIP(url.hostname) && this.isPrivateIP(url.hostname)) {
      return {
        isValid: false,
        error: 'Private IP addresses are not allowed in production'
      };
    }

    // Check for suspicious TLDs
    const suspiciousTLDs = ['.tk', '.ml', '.ga', '.cf']; // Common spam domains
    if (suspiciousTLDs.some(tld => url.hostname.endsWith(tld))) {
      return {
        isValid: false,
        error: 'Domain uses suspicious TLD'
      };
    }

    // Validate port ranges
    if (url.port) {
      const port = parseInt(url.port, 10);
      if (port < 80 || port > 65535 || this.isRestrictedPort(port)) {
        return {
          isValid: false,
          error: `Port ${port} is not allowed`
        };
      }
    }

    return { isValid: true };
  }

  private isPrivateIP(ip: string): boolean {
    if (!validator.isIP(ip)) return false;
    
    // IPv4 private ranges
    const ipv4Ranges = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./, // Link-local
      /^127\./ // Loopback
    ];
    
    return ipv4Ranges.some(range => range.test(ip));
  }

  private isRestrictedPort(port: number): boolean {
    // Well-known restricted ports
    const restrictedPorts = [
      22, 23, 25, 53, 135, 137, 138, 139, 445, // System ports
      1433, 3306, 5432, 6379, 27017, // Database ports
      8080, 8443, 9200, 9300 // Common service ports
    ];
    
    return restrictedPorts.includes(port);
  }

  private containsMaliciousPatterns(value: string): boolean {
    const maliciousPatterns = [
      /<script/i,
      /javascript:/i,
      /vbscript:/i,
      /data:/i,
      /\.\.\//, // Directory traversal
      /%2e%2e%2f/i, // Encoded directory traversal
      /%00/i, // Null byte
      /\x00/, // Actual null byte
    ];
    
    return maliciousPatterns.some(pattern => pattern.test(value));
  }
}

// Export singleton instance
export const urlValidator = URLValidator.getInstance();