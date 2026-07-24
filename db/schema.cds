using { cuid, managed } from '@sap/cds/common';

namespace supplierresilience;

entity ![Case] : cuid, managed {
    caseId      : String(20);
    eventId     : String(20);
    status      : String(20);
    priority    : String(20);
    eventType   : String(30);
    po          : String(20);
    supplier    : String(60);
    material    : String(60);
    plant       : String(40);
    delayedDays : Integer;
    eventTime   : Timestamp;
}