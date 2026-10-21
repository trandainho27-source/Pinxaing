import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--experimental-transform-types','--test','tests/commerce.test.ts','tests/legacy-commerce.test.ts','tests/accounts-management.test.ts','tests/store-upgrade.test.ts'],{stdio:'inherit'});process.exitCode=result.status||0;
