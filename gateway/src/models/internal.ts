/**
 * Production-grade type definitions for internal API communication.
 */

// Base internal response wrapper
export interface InternalResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  requestId: string;
  timestamp: string;
  service: string;
}

// Profile operation models
export interface ProfileUpdateRequest {
  field?: string;
  value?: string;
  note?: string;
  /** Remove the first note whose text contains this string (e.g. "mother", "Namrata"). */
  remove_note?: string;
  metadata?: Record<string, any>;
}

export interface ProfileNote {
  text: string;
  timestamp: string | null;
}

export interface ProfileCustomData {
  notes?: ProfileNote[];
  previousValues?: Record<string, Array<{ value: any; timestamp: string }>>;
  [key: string]: any;
}

export interface UserProfileResponse {
  fullName: string | null;
  preferredName: string | null;
  timezone: string | null;
  contactEmail: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  preferences: string | null;
  biography: string | null;
  customData: ProfileCustomData | null;
  updatedAt: string | null;
}

// Gmail operation models
export interface GmailThreadRequest {
  query?: string;
  maxResults?: number;
  pageToken?: string;
}

export interface GmailThreadResponse {
  threads: Array<{
    id: string;
    snippet: string;
    historyId: string;
    subject?: string;
    from?: string;
    date?: string;
  }>;
  nextPageToken?: string;
  resultSizeEstimate: number;
}

// Memory operation models  
export interface MemorySearchRequest {
  query: string;
  limit?: number;
  threshold?: number;
}

export interface MemorySearchResult {
  content: string;
  score: number;
  metadata: Record<string, any>;
  timestamp: string;
}

export interface MemorySearchResponse {
  results: MemorySearchResult[];
  total: number;
  queryTime: number;
}

// Validation helpers
export function validateProfileUpdateRequest(data: any): data is ProfileUpdateRequest {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const { field, value, note, remove_note, metadata } = data;

  // Must have field+value, note, or remove_note
  const hasFieldValue = typeof field === 'string' && field.length > 0 &&
                       typeof value === 'string';
  const hasNote = typeof note === 'string' && note.length > 0;
  const hasRemoveNote = typeof remove_note === 'string' && remove_note.length > 0;

  if (!hasFieldValue && !hasNote && !hasRemoveNote) {
    return false;
  }

  // Field validation
  if (field !== undefined) {
    if (typeof field !== 'string' || field.length === 0 || field.length > 50) {
      return false;
    }
  }

  // Value validation  
  if (value !== undefined) {
    if (typeof value !== 'string' || value.length > 2000) {
      return false;
    }
  }

  // Note validation
  if (note !== undefined) {
    if (typeof note !== 'string' || note.length === 0 || note.length > 2000) {
      return false;
    }
  }

  // remove_note validation
  if (remove_note !== undefined) {
    if (typeof remove_note !== 'string' || remove_note.length === 0 || remove_note.length > 200) {
      return false;
    }
  }

  // Metadata validation
  if (metadata !== undefined) {
    if (typeof metadata !== 'object' || metadata === null) {
      return false;
    }
  }

  return true;
}

export function createSuccessResponse<T>(
  data: T,
  requestId: string,
  service: string = 'gateway'
): InternalResponse<T> {
  return {
    success: true,
    data,
    requestId,
    timestamp: new Date().toISOString(),
    service
  };
}

export function createErrorResponse(
  error: string,
  code: string,
  requestId: string,
  service: string = 'gateway'
): InternalResponse {
  return {
    success: false,
    error,
    code,
    requestId,
    timestamp: new Date().toISOString(),
    service
  };
}

// Known profile fields for validation
export const VALID_PROFILE_FIELDS = new Set([
  'fullName', 'full_name',
  'preferredName', 'preferred_name', 
  'timezone',
  'contactEmail', 'contact_email',
  'phone',
  'company',
  'role',
  'preferences',
  'biography'
]);

export function isValidProfileField(field: string): boolean {
  return VALID_PROFILE_FIELDS.has(field);
}