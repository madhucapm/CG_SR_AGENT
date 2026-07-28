const cds = require('@sap/cds');

module.exports = cds.service.impl(async function() {
    
    const { Cases } = this.entities;
    
    /**
     * Early Warning Agent - Trigger Delay Alert
     * This action creates a new case when a delivery delay is detected
     */
    this.on('triggerDelayAlert', async (req) => {
        const { supplier, material, delayedDays, po, plant } = req.data;
        
        // Validate required fields
        if (!supplier || !material || delayedDays === undefined) {
            return {
                success: false,
                message: 'Missing required fields: supplier, material, and delayedDays are required',
                caseId: null,
                eventId: null,
                priority: null,
                alertTime: null
            };
        }
        
        // Generate unique IDs
        const timestamp = Date.now();
        const caseId = `CASE-${timestamp}`;
        const eventId = `EVT-${timestamp}`;
        const alertTime = new Date().toISOString();
        
        // Calculate priority based on delay days
        let priority;
        if (delayedDays >= 14) {
            priority = 'Critical';
        } else if (delayedDays >= 7) {
            priority = 'High';
        } else if (delayedDays >= 3) {
            priority = 'Medium';
        } else {
            priority = 'Low';
        }
        
        try {
            // Insert new case record into database
            await INSERT.into(Cases).entries({
                caseId: caseId,
                eventId: eventId,
                eventType: 'Delivery Delay',
                status: 'Open',
                priority: priority,
                supplier: supplier || '',
                material: material || '',
                delayedDays: delayedDays,
                po: po || '',
                plant: plant || '',
                eventTime: alertTime
            });
            
            // Log the alert
            console.log(`[Early Warning Agent] ALERT TRIGGERED!`);
            console.log(`  Case ID: ${caseId}`);
            console.log(`  Supplier: ${supplier}`);
            console.log(`  Material: ${material}`);
            console.log(`  Delayed Days: ${delayedDays}`);
            console.log(`  Priority: ${priority}`);
            console.log(`  Alert Time: ${alertTime}`);
            
            return {
                success: true,
                message: `🚨 Early Warning Alert! Delivery delay of ${delayedDays} days detected for supplier "${supplier}" on material "${material}". Priority: ${priority}`,
                caseId: caseId,
                eventId: eventId,
                priority: priority,
                alertTime: alertTime
            };
            
        } catch (error) {
            console.error('[Early Warning Agent] Error creating case:', error);
            return {
                success: false,
                message: `Failed to create alert: ${error.message}`,
                caseId: null,
                eventId: null,
                priority: null,
                alertTime: null
            };
        }
    });
    
});