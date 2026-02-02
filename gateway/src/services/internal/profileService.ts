/**
 * Production-grade internal profile service with comprehensive business logic.
 */
import { getUserProfile, upsertUserProfile, ensureUserRecord } from '../db';
import { 
  ProfileUpdateRequest, 
  UserProfileResponse, 
  ProfileNote,
  ProfileCustomData,
  isValidProfileField 
} from '../../models/internal';
import { normalizeProfileNotes } from '../../utils/profile';

export interface ProfileUpdateResult {
  success: boolean;
  profile?: UserProfileResponse;
  error?: string;
  code?: string;
  changes?: string[];
}

export interface ProfileValidationError {
  field: string;
  message: string;
  code: string;
}

/**
 * Internal profile service with comprehensive validation and business logic.
 */
export class InternalProfileService {
  
  // Known field mappings for API conversion
  private static readonly FIELD_MAPPINGS: Record<string, string> = {
    'full_name': 'fullName',
    'preferred_name': 'preferredName',
    'contact_email': 'contactEmail'
  };

  /**
   * Get user profile with proper error handling.
   */
  async getProfile(userId: string): Promise<UserProfileResponse | null> {
    try {
      await ensureUserRecord(userId);
      const profile = await getUserProfile(userId);
      
      if (!profile) {
        return null;
      }

      return this.formatProfileResponse(profile);
    } catch (error) {
      console.error('[InternalProfileService] Failed to get profile', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Update user profile with comprehensive validation and audit logging.
   */
  async updateProfile(userId: string, request: ProfileUpdateRequest): Promise<ProfileUpdateResult> {
    try {
      // Ensure user exists
      await ensureUserRecord(userId);

      // Validate request
      const validationErrors = await this.validateUpdateRequest(request);
      if (validationErrors.length > 0) {
        return {
          success: false,
          error: `Validation failed: ${validationErrors.map(e => e.message).join(', ')}`,
          code: 'VALIDATION_ERROR'
        };
      }

      // Get existing profile for comparison and history
      const existingProfile = await getUserProfile(userId);
      
      // Process the update
      const updatePayload = await this.buildUpdatePayload(request, existingProfile);
      const changes = this.detectChanges(request, existingProfile);

      // Perform database update if there are changes
      if (Object.keys(updatePayload).length === 0) {
        return {
          success: true,
          profile: this.formatProfileResponse(existingProfile),
          changes: ['No changes detected']
        };
      }

      await upsertUserProfile(userId, updatePayload);
      
      // Get updated profile
      const updatedProfile = await getUserProfile(userId);
      
      // Log the change for audit
      console.info('[InternalProfileService] Profile updated', {
        userId,
        changes,
        requestField: request.field,
        hasNote: !!request.note
      });

      return {
        success: true,
        profile: this.formatProfileResponse(updatedProfile),
        changes
      };

    } catch (error) {
      console.error('[InternalProfileService] Failed to update profile', {
        userId,
        error: error instanceof Error ? error.message : String(error),
        request: this.sanitizeLogRequest(request)
      });

      return {
        success: false,
        error: 'Internal server error during profile update',
        code: 'INTERNAL_ERROR'
      };
    }
  }

  /**
   * Validate profile update request with comprehensive checks.
   */
  private async validateUpdateRequest(request: ProfileUpdateRequest): Promise<ProfileValidationError[]> {
    const errors: ProfileValidationError[] = [];

    // Check that either field+value or note is provided
    const hasFieldValue = request.field && request.value !== undefined;
    const hasNote = request.note && request.note.trim().length > 0;

    if (!hasFieldValue && !hasNote) {
      errors.push({
        field: 'request',
        message: 'Either field+value or note must be provided',
        code: 'MISSING_DATA'
      });
      return errors;
    }

    // Validate field if provided
    if (request.field) {
      if (typeof request.field !== 'string' || request.field.length === 0) {
        errors.push({
          field: 'field',
          message: 'Field name must be a non-empty string',
          code: 'INVALID_FIELD_NAME'
        });
      } else if (request.field.length > 50) {
        errors.push({
          field: 'field', 
          message: 'Field name too long (max 50 characters)',
          code: 'FIELD_TOO_LONG'
        });
      }

      // Validate known fields
      const normalizedField = this.normalizeFieldName(request.field);
      if (normalizedField && !isValidProfileField(normalizedField)) {
        // For unknown fields, just log a warning but allow them in customData
        console.warn('[InternalProfileService] Unknown field used', {
          field: request.field,
          normalizedField
        });
      }
    }

    // Validate value if provided
    if (hasFieldValue && request.value !== undefined) {
      if (typeof request.value !== 'string') {
        errors.push({
          field: 'value',
          message: 'Value must be a string',
          code: 'INVALID_VALUE_TYPE'
        });
      } else if (request.value.length > 2000) {
        errors.push({
          field: 'value',
          message: 'Value too long (max 2000 characters)',
          code: 'VALUE_TOO_LONG'
        });
      }

      // Field-specific validation
      if (request.field) {
        const fieldErrors = this.validateFieldValue(request.field, request.value);
        errors.push(...fieldErrors);
      }
    }

    // Validate note if provided
    if (request.note !== undefined) {
      if (typeof request.note !== 'string') {
        errors.push({
          field: 'note',
          message: 'Note must be a string',
          code: 'INVALID_NOTE_TYPE'
        });
      } else if (request.note.trim().length === 0) {
        errors.push({
          field: 'note',
          message: 'Note cannot be empty',
          code: 'EMPTY_NOTE'
        });
      } else if (request.note.length > 2000) {
        errors.push({
          field: 'note',
          message: 'Note too long (max 2000 characters)',
          code: 'NOTE_TOO_LONG'
        });
      }
    }

    return errors;
  }

  /**
   * Validate field-specific values.
   */
  private validateFieldValue(field: string, value: string): ProfileValidationError[] {
    const errors: ProfileValidationError[] = [];
    const normalizedField = this.normalizeFieldName(field);

    switch (normalizedField) {
      case 'contactEmail':
        if (value && !this.isValidEmail(value)) {
          errors.push({
            field,
            message: 'Invalid email format',
            code: 'INVALID_EMAIL'
          });
        }
        break;

      case 'timezone':
        if (value && !this.isValidTimezone(value)) {
          errors.push({
            field,
            message: 'Invalid timezone format', 
            code: 'INVALID_TIMEZONE'
          });
        }
        break;

      case 'phone':
        if (value && value.length > 20) {
          errors.push({
            field,
            message: 'Phone number too long (max 20 characters)',
            code: 'PHONE_TOO_LONG'
          });
        }
        break;
    }

    return errors;
  }

  /**
   * Build database update payload from request.
   */
  private async buildUpdatePayload(
    request: ProfileUpdateRequest, 
    existingProfile: any
  ): Promise<Record<string, any>> {
    const payload: Record<string, any> = {};
    
    // Handle field updates
    if (request.field && request.value !== undefined) {
      const normalizedField = this.normalizeFieldName(request.field);
      
      if (normalizedField && isValidProfileField(normalizedField)) {
        // Known field - update directly
        payload[normalizedField] = request.value;
      } else {
        // Unknown field - add to customData
        const customData = this.buildCustomDataUpdate(request, existingProfile);
        if (customData) {
          payload.customData = customData;
        }
      }
    }

    // Handle note additions
    if (request.note) {
      const customData = this.buildCustomDataUpdate(request, existingProfile);
      if (customData) {
        payload.customData = customData;
      }
    }

    return payload;
  }

  /**
   * Build custom data updates for notes and unknown fields.
   */
  private buildCustomDataUpdate(request: ProfileUpdateRequest, existingProfile: any): ProfileCustomData | null {
    const existingCustom = existingProfile?.customData || {};
    const customData: ProfileCustomData = { ...existingCustom };
    let hasChanges = false;

    // Handle note addition
    if (request.note) {
      const existingNotes = normalizeProfileNotes(customData.notes || []);
      const newNote: ProfileNote = {
        text: request.note,
        timestamp: new Date().toISOString()
      };
      
      // Check for duplicate notes
      const isDuplicate = existingNotes.some(note => 
        note.text === newNote.text && 
        Math.abs(new Date(note.timestamp || 0).getTime() - new Date(newNote.timestamp).getTime()) < 60000 // 1 minute
      );
      
      if (!isDuplicate) {
        customData.notes = [...existingNotes, newNote];
        hasChanges = true;
      }
    }

    // Handle custom field updates
    if (request.field && !isValidProfileField(this.normalizeFieldName(request.field))) {
      const existingValue = customData[request.field];
      if (existingValue !== request.value) {
        customData[request.field] = request.value;
        hasChanges = true;

        // Track previous values
        if (!customData.previousValues) {
          customData.previousValues = {};
        }
        if (!customData.previousValues[request.field]) {
          customData.previousValues[request.field] = [];
        }
        
        if (existingValue !== undefined) {
          customData.previousValues[request.field].push({
            value: existingValue,
            timestamp: new Date().toISOString()
          });
        }
      }
    }

    return hasChanges ? customData : null;
  }

  /**
   * Detect changes for audit logging.
   */
  private detectChanges(request: ProfileUpdateRequest, existingProfile: any): string[] {
    const changes: string[] = [];

    if (request.field && request.value !== undefined) {
      const normalizedField = this.normalizeFieldName(request.field);
      const existingValue = normalizedField ? existingProfile?.[normalizedField] : existingProfile?.customData?.[request.field];
      
      if (existingValue !== request.value) {
        changes.push(`Updated ${request.field}: "${existingValue}" → "${request.value}"`);
      }
    }

    if (request.note) {
      changes.push(`Added note: "${request.note.substring(0, 50)}${request.note.length > 50 ? '...' : ''}"`);
    }

    return changes.length > 0 ? changes : ['No changes'];
  }

  /**
   * Format profile for API response. Pass through full document so any key is returned (scalable).
   */
  private formatProfileResponse(profile: any): UserProfileResponse {
    if (!profile) {
      throw new Error('Profile is null or undefined');
    }
    const base = {
      fullName: profile.fullName ?? null,
      preferredName: profile.preferredName ?? null,
      timezone: profile.timezone ?? null,
      contactEmail: profile.contactEmail ?? null,
      phone: profile.phone ?? null,
      company: profile.company ?? null,
      role: profile.role ?? null,
      preferences: profile.preferences ?? null,
      biography: profile.biography ?? null,
      customData: profile.customData ?? null,
      updatedAt: profile.updatedAt ? new Date(profile.updatedAt).toISOString() : null
    };
    return { ...profile, ...base } as UserProfileResponse;
  }

  /**
   * Normalize field name for consistent API usage.
   */
  private normalizeFieldName(field: string): string {
    return InternalProfileService.FIELD_MAPPINGS[field] || field;
  }

  /**
   * Email validation.
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Basic timezone validation.
   */
  private isValidTimezone(timezone: string): boolean {
    // Basic validation - could be enhanced with full timezone list
    return /^[A-Z][a-z]+\/[A-Z][a-z_]+$|^UTC[+-]?\d{1,2}$|^GMT[+-]?\d{1,2}$/i.test(timezone);
  }

  /**
   * Sanitize request for logging (remove sensitive data).
   */
  private sanitizeLogRequest(request: ProfileUpdateRequest): Record<string, any> {
    return {
      field: request.field,
      hasValue: !!request.value,
      hasNote: !!request.note,
      valueLength: request.value?.length,
      noteLength: request.note?.length
    };
  }
}