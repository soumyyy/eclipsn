import cron from 'node-cron';
import { listUsersWithWhoopIntegration, saveWhoopCycle, saveWhoopRecovery, saveWhoopSleep, saveWhoopWorkout, saveWhoopMeasurement } from '../services/db';
import { fetchWhoopCycle, fetchWhoopRecovery, fetchWhoopSleep, fetchWhoopWorkout, fetchWhoopMeasurements } from '../services/whoopClient';

async function syncWhoopData() {
    console.log('[Whoop Sync] Starting sync...');
    const userIds = await listUsersWithWhoopIntegration();
    if (userIds.length === 0) {
        console.log('[Whoop Sync] No users connected.');
        return;
    }

    for (const userId of userIds) {
        try {
            console.log(`[Whoop Sync] Syncing for user ${userId}`);

            // Sync Cycles
            const cycle = await fetchWhoopCycle(userId);
            if (cycle) await saveWhoopCycle(userId, cycle);

            // Sync Recovery
            const recovery = await fetchWhoopRecovery(userId);
            if (recovery) await saveWhoopRecovery(userId, recovery);

            // Sync Sleep
            const sleep = await fetchWhoopSleep(userId);
            if (sleep) await saveWhoopSleep(userId, sleep);

            // Sync Workout
            const workout = await fetchWhoopWorkout(userId);
            if (workout) await saveWhoopWorkout(userId, workout);

            // Sync Measurements (less frequent, but fine to check)
            const meas = await fetchWhoopMeasurements(userId);
            if (meas) await saveWhoopMeasurement(userId, meas);

            console.log(`[Whoop Sync] Completed for user ${userId}`);
        } catch (e: any) {
            console.error(`[Whoop Sync] Failed for user ${userId}:`, e.message);
        }
    }
    console.log('[Whoop Sync] Finished.');
}

export function scheduleWhoopJobs() {
    // Run every 30 minutes
    cron.schedule('*/30 * * * *', () => {
        syncWhoopData();
    });
    console.log('[Whoop Jobs] Scheduled 30m sync.');

    // Run once on startup (optional, good for dev)
    // setTimeout(syncWhoopData, 5000); 
}
