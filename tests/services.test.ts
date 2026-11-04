import {describe,expect,it} from 'vitest';
import {accountSetupWindow} from '../src/shared/services';
describe('two-hour service windows in Arizona',()=>{
 it('opens exactly two hours before service and stays open during it',()=>{expect(accountSetupWindow(new Date('2026-10-11T07:59:59-07:00')).accountCreationAllowed).toBe(false);for(const t of ['08:00:00','10:00:00','13:59:59'])expect(accountSetupWindow(new Date('2026-10-11T'+t+'-07:00')).accountCreationAllowed).toBe(true);});
 it('closes two hours after the scheduled ending',()=>{expect(accountSetupWindow(new Date('2026-10-11T14:00:00-07:00')).accountCreationAllowed).toBe(false);});
 it('covers evening services across UTC midnight',()=>{expect(accountSetupWindow(new Date('2026-10-11T22:59:59Z')).accountCreationAllowed).toBe(false);expect(accountSetupWindow(new Date('2026-10-11T23:00:00Z')).accountCreationAllowed).toBe(true);expect(accountSetupWindow(new Date('2026-10-12T04:59:59Z')).accountCreationAllowed).toBe(true);expect(accountSetupWindow(new Date('2026-10-12T05:00:00Z')).accountCreationAllowed).toBe(false);});
 it('uses the published shared Tuesday ending for prayer and youth',()=>{expect(accountSetupWindow(new Date('2026-10-13T22:59:59-07:00')).accountCreationAllowed).toBe(true);expect(accountSetupWindow(new Date('2026-10-13T23:00:00-07:00')).accountCreationAllowed).toBe(false);expect(accountSetupWindow(new Date('2026-10-14T00:00:00-07:00')).accountCreationAllowed).toBe(false);});
});
