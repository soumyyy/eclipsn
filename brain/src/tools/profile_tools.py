"""
Production-ready profile tools using Gateway internal API.
Provides secure and reliable service-to-service communication.
"""
import logging
from typing import Optional

from ..services.internal_client import get_internal_client, InternalAPIError

logger = logging.getLogger(__name__)


async def profile_update_tool(
    field: Optional[str] = None, 
    value: Optional[str] = None, 
    note: Optional[str] = None,
    user_id: Optional[str] = None
) -> str:
    """
    Update user profile with field/value pairs or add notes via Gateway internal API.
    
    Args:
        field: Profile field name (e.g., 'full_name', 'company', 'timezone')
        value: New value for the field
        note: Free-form note to add to profile
        user_id: User ID (passed from chat context)
        
    Returns:
        Success/failure message with details
    """
    if not user_id:
        logger.error("[ProfileTool] Profile update attempted without user_id")
        return "Error: User ID required for profile updates."
    
    try:
        # Validate input
        if not field and not note:
            return "No profile changes supplied. Please provide either a field/value pair or a note."
            
        if field and not value:
            return "Field specified but no value provided. Please include both field and value."
            
        # Get internal client
        client = await get_internal_client()
        
        # Make the update request
        result = await client.update_profile(
            user_id=user_id,
            field=field,
            value=value,
            note=note
        )
        
        # Format success response
        changes = result.get("changes", [])
        if changes and changes != ["No changes"]:
            change_summary = f" Changes: {', '.join(changes[:2])}" + ("..." if len(changes) > 2 else "")
            return f"Profile updated successfully.{change_summary}"
        else:
            return "Profile updated successfully."
            
    except InternalAPIError as e:
        logger.error(f"[ProfileTool] Internal API error for user {user_id}: {e}")
        if e.status_code == 400:
            return f"Profile update failed: {e.response_data.get('error', 'Invalid request')}"
        elif e.status_code == 401:
            return "Profile update failed: Authentication error."
        elif e.status_code == 404:
            return "Profile update failed: User not found."
        else:
            return f"Profile update failed: Service error ({e.status_code})"
    except ValueError as e:
        logger.warning(f"[ProfileTool] Invalid input for user {user_id}: {e}")
        return f"Invalid input: {e}"
    except Exception as e:
        logger.error(f"[ProfileTool] Unexpected error for user {user_id}: {e}")
        return "Profile update failed due to an unexpected error. Please try again."


async def profile_remove_note_tool(user_id: Optional[str], text_or_topic: str) -> str:
    """
    Remove the first profile note whose text contains the given string.
    Use when the user says 'forget that' and the fact was in their profile (no memory id from memory_lookup).
    Pass a short topic or phrase (e.g. 'mother', 'Namrata') to match the note to remove.
    """
    if not user_id:
        logger.error("[ProfileTool] Profile remove_note attempted without user_id")
        return "Error: User ID required."
    text = (text_or_topic or "").strip()
    if not text:
        return "Please provide the topic or text to remove (e.g. 'mother', 'Namrata')."
    try:
        client = await get_internal_client()
        result = await client.update_profile(user_id=user_id, remove_note=text)
        if not result.get("success"):
            return result.get("error", "Failed to remove note.")
        changes = result.get("changes", [])
        if changes and "Removed" in str(changes):
            return "That information has been removed from your profile."
        return "No matching note was found in your profile; it may already have been removed."
    except InternalAPIError as e:
        logger.warning("[ProfileTool] remove_note API error for user %s: %s", user_id, e)
        return f"Could not remove note: {e.response_data.get('error', 'Service error')}"
    except Exception as e:
        logger.error("[ProfileTool] remove_note error for user %s: %s", user_id, e)
        return "Failed to remove that from your profile. Please try again."


async def get_profile_tool(user_id: Optional[str] = None) -> str:
    """
    Get user profile information via Gateway internal API.
    
    Args:
        user_id: User ID (passed from chat context)
        
    Returns:
        Formatted profile information or error message
    """
    if not user_id:
        logger.error("[ProfileTool] Profile lookup attempted without user_id") 
        return "Error: User ID required for profile lookup."
        
    try:
        # Get internal client
        client = await get_internal_client()
        
        # Fetch profile
        profile = await client.get_profile(user_id)
        
        if not profile:
            return "No profile found for this user."
            
        # Format profile information
        info_parts = []
        
        # Add basic information
        if profile.get("fullName"):
            info_parts.append(f"Name: {profile['fullName']}")
        elif profile.get("preferredName"):
            info_parts.append(f"Name: {profile['preferredName']}")
            
        if profile.get("company"):
            info_parts.append(f"Company: {profile['company']}")
            
        if profile.get("role"):
            info_parts.append(f"Role: {profile['role']}")
            
        if profile.get("contactEmail"):
            info_parts.append(f"Email: {profile['contactEmail']}")
            
        if profile.get("timezone"):
            info_parts.append(f"Timezone: {profile['timezone']}")
        
        # Add recent notes from custom data
        custom_data = profile.get("customData", {})
        if custom_data and custom_data.get("notes"):
            recent_notes = custom_data["notes"][-3:]  # Last 3 notes
            if recent_notes:
                notes_text = []
                for note in recent_notes:
                    if isinstance(note, dict) and note.get("text"):
                        notes_text.append(note["text"])
                    elif isinstance(note, str):
                        notes_text.append(note)
                
                if notes_text:
                    info_parts.append(f"Recent notes: {'; '.join(notes_text)}")
        
        # Add last updated info
        if profile.get("updatedAt"):
            try:
                from datetime import datetime
                updated = datetime.fromisoformat(profile["updatedAt"].replace('Z', '+00:00'))
                info_parts.append(f"Last updated: {updated.strftime('%Y-%m-%d')}")
            except Exception:
                pass  # Skip if date parsing fails
                
        if info_parts:
            return "Profile: " + "; ".join(info_parts)
        else:
            return "Profile exists but no details are available."
        
    except InternalAPIError as e:
        logger.error(f"[ProfileTool] Internal API error for user {user_id}: {e}")
        if e.status_code == 404:
            return "No profile found for this user."
        elif e.status_code == 401:
            return "Failed to get profile: Authentication error."
        else:
            return f"Failed to get profile: Service error ({e.status_code})"
    except Exception as e:
        logger.error(f"[ProfileTool] Unexpected error for user {user_id}: {e}")
        return "Failed to get profile due to an unexpected error."
