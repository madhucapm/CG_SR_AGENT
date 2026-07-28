using { supplierresilience } from '../db/schema';

@path: 'supplier-resilience'
service SupplierResilienceService {
    entity Cases as projection on supplierresilience.![Case];
    
    // Custom action for Early Warning Agent - Trigger Delay Alert
    action triggerDelayAlert(
        supplier: String,
        material: String,
        delayedDays: Integer,
        po: String,
        plant: String
    ) returns {
        success: Boolean;
        message: String;
        caseId: String;
        eventId: String;
        priority: String;
        alertTime: Timestamp
    };
}