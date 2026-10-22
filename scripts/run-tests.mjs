import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--experimental-transform-types','--test','tests/commerce.test.ts','tests/legacy-commerce.test.ts','tests/accounts-management.test.ts','tests/store-upgrade.test.ts','tests/direct-recharge.test.ts'],{stdio:'inherit'});if(result.error)throw result.error;
if(result.signal)console.error('Test process interrupted:',result.signal);
process.exitCode=result.status??1;
