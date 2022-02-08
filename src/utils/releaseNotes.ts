import { ReleaseNote } from '../controllers/PreferencesController';
import compareVersions from 'compare-versions';
interface Options {
    lastVersionSeen?: string;
    stackNotes?: boolean;
}

const defaultOptions: Options = {
    stackNotes: true,
};

const generateReleaseNotesNews = (
    releasesNotes: ReleaseNote[],
    userCurrentVersion: string,
    options: Options = defaultOptions
): ReleaseNote[] | null => {
    if (!compareVersions.validate(userCurrentVersion)) {
        return null;
    }
    const safeOptions = {
        ...defaultOptions,
        ...options,
    };
    let sortedNotes = [...releasesNotes].sort((r1, r2) => compareVersions(r2.version, r1.version));

    if (safeOptions.lastVersionSeen) {
        sortedNotes = sortedNotes.filter(
            ({ version }) =>
                compareVersions(version, safeOptions.lastVersionSeen || '') > 0
        );
    }

    const filteredNotes = sortedNotes.filter(
        ({ version }) => compareVersions(userCurrentVersion, version) > -1
    );

    //keep last version only
    if (filteredNotes.length && !safeOptions.stackNotes) {
        return [filteredNotes[0]];
    }

    return filteredNotes;
};

export { generateReleaseNotesNews };
