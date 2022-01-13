import { IMigration } from '../IMigration';
import migration01 from './migration-01';
import migration02 from './migration-02';
import migration03 from './migration-03';
import migration04 from './migration-04';

const migrations: IMigration[] = [
    migration01,
    migration02,
    migration03,
    migration04,
];
export default (): IMigration[] => migrations;
