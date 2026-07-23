using { cuid, managed } from '@sap/cds/common';

namespace supplierresilience;

entity ![Case] : cuid, managed {
    caseId   : String(20);
    eventId  : String(20);
    status   : String(20);
    priority : String(20);
}