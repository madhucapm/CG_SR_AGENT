using { supplierresilience } from '../db/schema';

service SupplierResilienceService {
    entity Cases as projection on supplierresilience.![Case];
}