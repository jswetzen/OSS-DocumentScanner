import { Application, ApplicationSettings, File, Folder, ImageSource, path } from '@nativescript/core';
import { Observable } from '@nativescript/core';
import { AuthType, FileStat, WebDAVClient, createClient, createContext } from '~/webdav';
import { request as webdavRequest } from '~/webdav/request';
import { basename } from '~/webdav/tools/path';
import { documentsService } from './documents';
import SqlQuery from '@akylas/kiss-orm/dist/Queries/SqlQuery';
import { Document, IMG_COMPRESS, IMG_FORMAT, OCRDocument, OCRPage } from '~/models/OCRDocument';
import { networkService } from './api';
import { loadImage, recycleImages } from '~/utils/utils';
import { cropDocument } from 'plugin-nativeprocessor';
import { exists } from '~/webdav/operations/exists';
import { debounce } from '@nativescript/core/utils';
import { showError } from '~/utils/error';

const SETTINGS_KEY = 'webdav_config';
function findArrayDiffs<S, T>(array1: S[], array2: T[], compare: (a: S, b: T) => boolean) {
    const union: S[] = [];
    array1 = Array.from(array1);
    array2 = Array.from(array2);
    for (let i = 0; i < array1.length; i++) {
        const a = array1[i];
        for (let j = 0; j < array2.length; j++) {
            const b = array2[j];
            if (compare(a, b)) {
                union.push(a);
                array1.splice(i, 1);
                array2.splice(j, 1);
                i--;
                break;
            }
        }
    }
    return {
        toBeAdded: array2,
        toBeDeleted: array1,
        union
    };
}

export class SyncService extends Observable {
    remoteURL;
    username;
    remoteFolder;
    client: WebDAVClient;

    get enabled() {
        return !!this.client;
    }
    onDocumentAdded() {
        // TODO: fast and dirty
        DEV_LOG && console.log('SYNC', 'onDocumentAdded');
        this.syncDocuments();
    }
    onDocumentUpdated(event) {
        // TODO: fast and dirty
        DEV_LOG && console.log('SYNC', 'onDocumentUpdated', event.updateModifiedDate);
        if (event.updateModifiedDate !== false) {
            this.syncDocuments();
        }
    }
    async start() {
        const configStr = ApplicationSettings.getString(SETTINGS_KEY);
        if (configStr) {
            const config = JSON.parse(configStr);
            const { remoteURL, headers, authType, ...otherConfig } = config;
            // const context = createContext(config.remoteURL, { config.username, password, authType: AuthType.Password });
            this.remoteURL = remoteURL;
            this.remoteFolder = config.remoteFolder;
            this.username = config.username;
            this.client = createClient(remoteURL, {
                headers,
                authType: !authType || authType === AuthType.Password ? AuthType.None : authType,
                ...otherConfig
            });
            DEV_LOG && console.log('SyncService', 'start', config);
            this.notify({ eventName: 'state', enabled: this.enabled });
            documentsService.on('documentAdded', this.onDocumentAdded, this);
            documentsService.on('documentUpdated', this.onDocumentUpdated, this);
        }
        // this.username = 'farfromrefuge';
        // this.remoteUrl = `https://nextcloud.akylas.fr/remote.php/dav/files/${this.username}`;
        // this.remoteFolder = 'documents';
        // this.client = createClient(this.remoteUrl, {
        //     headers: {
        //         Authorization: 'Basic ZmFyZnJvbXJlZnVnZTpMdHZxSUk0d25mVWJkZWZiZkpNWnNKT1BWbzZZLzRHZzhpZWpSTHQ1eW1F'
        //     },
        //     authType: AuthType.None
        // });
    }
    stop() {
        documentsService.off('documentAdded', this.onDocumentAdded, this);
        documentsService.off('documentUpdated', this.onDocumentUpdated, this);
    }

    saveData({ remoteURL, username, password, remoteFolder, authType = AuthType.Password }) {
        if (remoteURL && username && password && remoteFolder) {

            // TODO: if we use digest we need a test connection to acquire the ha1
            const context = createContext(remoteURL, { username, password, authType });
            const config = { remoteURL, username, headers: context.headers, remoteFolder, ha1: context.ha1 || context.digest?.ha1, authType };
            DEV_LOG && console.log('saveData', context, config);
            ApplicationSettings.setString(SETTINGS_KEY, JSON.stringify(config));
            this.remoteFolder = remoteFolder;
            this.client = createClient(remoteURL, {
                headers: context.headers,
                authType: authType === AuthType.Password ? AuthType.None : authType,
                username: config.username,
                ha1: config.ha1
            });
            this.syncDocuments();
        } else {
            ApplicationSettings.remove(SETTINGS_KEY);
            this.client = null;
        }
        this.notify({ eventName: 'state', enabled: this.enabled });
    }
    async testConnection({ remoteURL, username, password, remoteFolder, authType = null }): Promise<boolean> {
        try {
            const context = createContext(remoteURL, { password, username, authType: authType || AuthType.Password });
            DEV_LOG && console.log('testConnection', context);
            const result = await exists(context, remoteFolder, { cachePolicy: 'noCache' });
            return true;
        } catch (error) {
            console.error(error);
            return false;
        }
    }

    async ensureRemoteFolder() {
        DEV_LOG && console.log('ensureRemoteFolder', this.remoteFolder);
        if (!(await this.client.exists(this.remoteFolder))) {
            await this.client.createDirectory(this.remoteFolder, { recursive: true });
        }
    }

    async getRemoteFolderDirectories(folderStr: string) {
        return this.client.getDirectoryContents(folderStr, { includeSelf: false, details: false });
    }
    async sendFolderToWebDav(folder: Folder, remotePath: string) {
        DEV_LOG && console.log('sendFolderToWebDav', folder, remotePath);
        await this.client.createDirectory(remotePath, { recursive: false });
        const entities = await folder.getEntities();
        for (let index = 0; index < entities.length; index++) {
            const entity = entities[index];
            if (entity instanceof File) {
                await this.client.putFileContents(path.join(remotePath, entity.name), File.fromPath(entity.path));
            } else {
                await this.sendFolderToWebDav(Folder.fromPath(entity.path), path.join(remotePath, entity.name));
            }
        }
    }

    async importFolderFromWebdav(remotePath: string, folder: Folder, ignores?: string[]) {
        console.log('importFolderFromWebdav', remotePath, folder.path, ignores);
        const remoteDocuments = (await this.getRemoteFolderDirectories(remotePath)) as FileStat[];
        for (let index = 0; index < remoteDocuments.length; index++) {
            const remoteDocument = remoteDocuments[index];
            if (ignores?.indexOf(remoteDocument.basename) >= 0) {
                continue;
            }
            if (remoteDocument.type === 'directory') {
                await this.importFolderFromWebdav(path.join(remotePath, remoteDocument.basename), folder.getFolder(remoteDocument.basename));
            } else {
                await this.client.getFileContents(path.join(remotePath, remoteDocument.basename), {
                    format: 'file',
                    destinationFilePath: path.join(folder.path, remoteDocument.basename)
                });
            }
        }
    }
    async addDocumentToWebdav(document: OCRDocument) {
        TEST_LOG && console.log('addDocumentToWebdav', document.id, document.pages);
        const docFolder = documentsService.dataFolder.getFolder(document.id);
        await this.sendFolderToWebDav(docFolder, path.join(this.remoteFolder, document.id));
        await this.client.putFileContents(path.join(this.remoteFolder, document.id, 'data.json'), document.toString());
        // mark the document as synced
        return document.save({ _synced: 1 }, false);
    }
    async importDocumentFromWebdav(data: FileStat) {
        const dataJSON = JSON.parse(
            await this.client.getFileContents(path.join(data.filename, 'data.json'), {
                format: 'text'
            })
        ) as Document & { pages: OCRPage[] };
        const { pages, ...docProps } = dataJSON;
        const doc = await documentsService.documentRepository.createDocument({ ...docProps, _synced: 1 });
        const docDataFolder = documentsService.dataFolder.getFolder(doc.id);
        TEST_LOG && console.log('importDocumentFromWebdav', docDataFolder.path, data, JSON.stringify(dataJSON));
        pages.forEach((page) => {
            const pageDataFolder = docDataFolder.getFolder(page.id);
            page.sourceImagePath = path.join(pageDataFolder.path, basename(page.sourceImagePath));
            page.imagePath = path.join(pageDataFolder.path, basename(page.imagePath));
        });
        await doc.addPages(pages);
        await doc.save({}, true);
        await this.importFolderFromWebdav(data.filename, docDataFolder, ['data.json']);
        TEST_LOG && console.log('importFolderFromWebdav done');
        documentsService.notify({ eventName: 'documentAdded', object: documentsService, doc });
        //_synced:1!
        // mark the document as synced
    }
    async syncDocumentOnWebdav(document: OCRDocument) {
        TEST_LOG && console.log('syncDocumentOnWebdav', document.id);
        const remoteDocPath = path.join(this.remoteFolder, document.id);
        const dataJSON = JSON.parse(
            await this.client.getFileContents(path.join(remoteDocPath, 'data.json'), {
                format: 'text'
            })
        ) as OCRDocument;
        const docDataFolder = documentsService.dataFolder.getFolder(document.id);
        if (dataJSON.modifiedDate > document.modifiedDate) {
            // DEV_LOG && console.log('syncDocumentOnWebdav', document.id, document.modifiedDate, dataJSON.modifiedDate);
            let needsRemoteDocUpdate = false;
            const { pages: docPages, ...docProps } = document.toJSONObject();
            const { pages: remotePages, ...remoteProps } = dataJSON;
            const toUpdate = {};
            Object.keys(remoteProps).forEach((k) => {
                if (k.startsWith('_')) {
                    return;
                }
                if (remoteProps[k] !== docProps[k]) {
                    toUpdate[k] = remoteProps[k];
                }
            });
            const { toBeAdded: missingRemotePages, toBeDeleted: removedRemotePages, union: toBeSyncPages } = findArrayDiffs(remotePages, docPages as OCRPage[], (a, b) => a.id === b.id);

            TEST_LOG && console.log('document need to be synced FROM webdav!', toUpdate, missingRemotePages, removedRemotePages, toBeSyncPages);
            for (let index = 0; index < removedRemotePages.length; index++) {
                const pageToRemove = removedRemotePages[index];
                const pageIndex = (docPages as OCRPage[]).findIndex((p) => p.id === pageToRemove.id);
                if (pageIndex !== -1) {
                    document.deletePage(pageIndex);
                }
            }
            for (let index = 0; index < missingRemotePages.length; index++) {
                const missingRemotePage = missingRemotePages[index];
                const pageDataFolder = docDataFolder.getFolder(missingRemotePage.id);
                missingRemotePage.sourceImagePath = path.join(pageDataFolder.path, basename(missingRemotePage.sourceImagePath));
                missingRemotePage.imagePath = path.join(pageDataFolder.path, basename(missingRemotePage.imagePath));
                await this.importFolderFromWebdav(path.join(remoteDocPath, missingRemotePage.id), pageDataFolder);
                // we insert page one by one because of the index
                await document.addPage(
                    missingRemotePage,
                    remotePages.findIndex((p) => p.id === missingRemotePage.id)
                );
                await document.save();
            }
            for (let index = 0; index < toBeSyncPages.length; index++) {
                const remotePageToSync = toBeSyncPages[index];
                const localPageIndex = (docPages as OCRPage[]).findIndex((p) => p.id === remotePageToSync.id);
                const localPage = (docPages as OCRPage[])[localPageIndex];
                if (remotePageToSync.modifiedDate > localPage.modifiedDate) {
                    //we need to update the data and then recreate the image if necessary
                    const { imagePath: localImagePath, sourceImagePath: localSourceImagePath, ...pageProps } = localPage;
                    const { imagePath: remoteImagePath, sourceImagePath: remoteSourceImagePath, ...remotePageProps } = remotePageToSync;
                    const pageTooUpdate: Partial<OCRPage> = {};
                    Object.keys(remotePageProps).forEach((k) => {
                        if (k.startsWith('_')) {
                            return;
                        }
                        if (remotePageProps[k] !== pageProps[k]) {
                            pageTooUpdate[k] = remotePageProps[k];
                        }
                    });
                    // check if we need to recreate the image
                    if (pageTooUpdate.crop || pageTooUpdate.transforms) {
                        const editingImage = await loadImage(localPage.sourceImagePath);
                        const images = await cropDocument(editingImage, [pageTooUpdate.crop]);

                        await new ImageSource(images[0]).saveToFileAsync(localPage.imagePath, IMG_FORMAT, IMG_COMPRESS);
                        recycleImages(editingImage, images);
                    }
                    await document.updatePage(localPageIndex, pageTooUpdate);
                } else if (remotePageToSync.modifiedDate < localPage.modifiedDate) {
                    //we need to update the data and then recreate the image if necessary
                    const { imagePath: localImagePath, sourceImagePath: localSourceImagePath, ...pageProps } = localPage;
                    const { imagePath: remoteImagePath, sourceImagePath: remoteSourceImagePath, ...remotePageProps } = remotePageToSync;
                    const pageTooUpdate: Partial<OCRPage> = {};
                    Object.keys(pageProps).forEach((k) => {
                        if (k.startsWith('_')) {
                            return;
                        }
                        if (remotePageProps[k] !== pageProps[k]) {
                            pageTooUpdate[k] = pageProps[k];
                        }
                    });
                    // check if we need to upload the image
                    if (pageTooUpdate.crop || pageTooUpdate.transforms) {
                        await this.client.putFileContents(path.join(remoteDocPath, basename(localImagePath)), localImagePath);
                    }
                    needsRemoteDocUpdate = true;
                }
            }
            TEST_LOG && console.log('update document', toUpdate);
            // mark the document as synced
            await document.save({ _synced: 1, ...toUpdate });

            if (needsRemoteDocUpdate) {
                await this.client.putFileContents(path.join(remoteDocPath, 'data.json'), document.toString());
            }
        } else if (dataJSON.modifiedDate < document.modifiedDate) {
            // DEV_LOG && console.log('syncDocumentOnWebdav', document.id, document.modifiedDate, dataJSON.modifiedDate);
            const { pages: docPages, ...docProps } = document.toJSONObject();
            const { pages: remotePages, ...remoteProps } = dataJSON;
            const toUpdate = {};
            Object.keys(remoteProps).forEach((k) => {
                if (k.startsWith('_')) {
                    return;
                }
                if (remoteProps[k] !== docProps[k]) {
                    toUpdate[k] = remoteProps[k];
                }
            });
            const { toBeAdded: missingRemotePages, toBeDeleted: removedRemotePages, union: toBeSyncPages } = findArrayDiffs(docPages as OCRPage[], remotePages, (a, b) => a.id === b.id);
            TEST_LOG && console.log('document need to be synced FROM local!', toUpdate);
            for (let index = 0; index < missingRemotePages.length; index++) {
                const missingRemotePage = missingRemotePages[index];
                const pageDataFolder = docDataFolder.getFolder(missingRemotePage.id);
                await this.sendFolderToWebDav(pageDataFolder, path.join(remoteDocPath, missingRemotePage.id));
            }
            for (let index = 0; index < removedRemotePages.length; index++) {
                const removedRemotePage = removedRemotePages[index];
                await this.client.deleteFile(path.join(remoteDocPath, removedRemotePage.id));
            }
            await this.client.putFileContents(path.join(remoteDocPath, 'data.json'), document.toString());
            return document.save({ _synced: 1 }, false);
        } else if (document._synced === 0) {
            TEST_LOG && console.log('syncDocumentOnWebdav just changing sync state');
            return document.save({ _synced: 1 }, false);
        }
    }
    syncRunning = false;
    syncDocuments = debounce(async (bothWays = false) => {
        try {
            if (!networkService.connected || !this.client || this.syncRunning) {
                return;
            }
            this.syncRunning = true;
            this.notify({ eventName: 'syncState', state: 'running' });
            TEST_LOG && console.log('syncDocuments', bothWays);
            const localDocuments = await documentsService.documentRepository.search({});
            TEST_LOG &&
                console.log(
                    'localDocuments',
                    localDocuments.map((d) => d.id)
                );

            if (bothWays) {
                await this.ensureRemoteFolder();
                const remoteDocuments = (await this.getRemoteFolderDirectories(this.remoteFolder)) as FileStat[];

                const {
                    toBeAdded: missingLocalDocuments,
                    toBeDeleted: missingRemoteDocuments,
                    union: toBeSyncDocuments
                } = findArrayDiffs(localDocuments, remoteDocuments, (a, b) => a.id === b.basename);

                TEST_LOG &&
                    console.log(
                        'missingRemoteDocuments',
                        missingRemoteDocuments.map((d) => d.id)
                    );
                TEST_LOG &&
                    console.log(
                        'missingLocalDocuments',
                        missingLocalDocuments.map((d) => d.basename)
                    );
                TEST_LOG &&
                    console.log(
                        'toBeSyncDocuments',
                        toBeSyncDocuments.map((d) => d.id)
                    );
                for (let index = 0; index < missingRemoteDocuments.length; index++) {
                    await this.addDocumentToWebdav(missingRemoteDocuments[index]);
                }
                for (let index = 0; index < missingLocalDocuments.length; index++) {
                    await this.importDocumentFromWebdav(missingLocalDocuments[index]);
                }
                for (let index = 0; index < toBeSyncDocuments.length; index++) {
                    await this.syncDocumentOnWebdav(toBeSyncDocuments[index]);
                }
            } else {
                const documentsToSync = localDocuments.filter((d) => !d._synced);
                if (documentsToSync.length) {
                    await this.ensureRemoteFolder();
                    const remoteDocuments = (await this.getRemoteFolderDirectories(this.remoteFolder)) as FileStat[];
                    const {
                        toBeAdded: missingLocalDocuments,
                        toBeDeleted: missingRemoteDocuments,
                        union: toBeSyncDocuments
                    } = findArrayDiffs(localDocuments, remoteDocuments, (a, b) => a.id === b.basename);

                    TEST_LOG &&
                        console.log(
                            'missingRemoteDocuments',
                            missingRemoteDocuments.map((d) => d.id)
                        );
                    TEST_LOG &&
                        console.log(
                            'missingLocalDocuments',
                            missingLocalDocuments.map((d) => d.basename)
                        );
                    TEST_LOG &&
                        console.log(
                            'toBeSyncDocuments',
                            toBeSyncDocuments.map((d) => d.id)
                        );
                    for (let index = 0; index < missingRemoteDocuments.length; index++) {
                        await this.addDocumentToWebdav(missingRemoteDocuments[index]);
                    }
                    // for (let index = 0; index < missingLocalDocuments.length; index++) {
                    //     await this.importDocumentFromWebdav(missingLocalDocuments[index]);
                    // }
                    for (let index = 0; index < toBeSyncDocuments.length; index++) {
                        await this.syncDocumentOnWebdav(toBeSyncDocuments[index]);
                    }
                }
            }
            this.syncRunning = false;
            this.notify({ eventName: 'syncState', state: 'finished' });
        } catch (error) {
            showError(error);
        }
    }, 1000);
}
export const syncService = new SyncService();
