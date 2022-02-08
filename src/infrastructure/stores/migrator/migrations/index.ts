import { IMigration } from '../IMigration';
import migration01 from './migration-01';
import migration02 from './migration-02';
import migration03 from './migration-03';
import migration04 from './migration-04';
import migration05 from './migration-05';
import migration06 from './migration-06';
import migration07 from './migration-07';
import migration08 from './migration-08';
import migration09 from './migration-09';
import migration10 from './migration-10';
import migration11 from './migration-11';
import migration12 from './migration-12';
import migration13 from './migration-13';
import migration14 from './migration-14';
import migration15 from './migration-15';
import migration16 from './migration-16';

const migrations: IMigration[] = [
    migration01,
    migration02,
    migration03,
    migration04,
    migration05,
    migration06,
    migration07,
    migration08,
    migration09,
    migration10,
    migration11,
    migration12,
    migration13,
    migration14,
    migration15,
    migration16,
];
export default (): IMigration[] => migrations;
