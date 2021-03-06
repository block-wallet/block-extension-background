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
import migration17 from './migration-17';
import migration18 from './migration-18';
import migration19 from './migration-19';
import migration20 from './migration-20';
import migration21 from './migration-21';
import migration22 from './migration-22';
import migration23 from './migration-23';
import migration24 from './migration-24';
import migration25 from './migration-25';
import migration26 from './migration-26';

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
    migration17,
    migration18,
    migration19,
    migration20,
    migration21,
    migration22,
    migration23,
    migration24,
    migration25,
    migration26,
];
export default (): IMigration[] => migrations;
