import { IMigration } from '../IMigration';
import migration01 from './migration-01';
import migration02 from './migration-02';
import migration03 from './migration-03';
import migration04 from './migration-04';
import migration05 from './migration-05';
import migration06 from './migration-06';

const migrations: IMigration[] = [
    migration01,
    migration02,
    migration03,
    migration04,
    migration05,
    migration06,
];
export default (): IMigration[] => migrations;
