import { getImagePipeline } from '@nativescript-community/ui-image';
import { EventData, File, ImageSource, Observable, ObservableArray, path } from '@nativescript/core';
import { documentsService } from '~/services/documents';
import { ColorMatricesType } from '~/utils/ui';
import { loadImage, recycleImages } from '~/utils/utils';

export interface ImageConfig {
    colorType?: ColorMatricesType;
    colorMatrix?: number[];
    rotation?: number;
}

export class Tag {
    public readonly id!: string;
    public name: string;
}

export const IMG_FORMAT = 'jpg';

export interface Document {
    id: string;
    createdDate: number;
    modifiedDate: number;
    name?: string;
    tags: string[];
    _synced: number;
}

export class OCRDocument extends Observable implements Document {
    // id: string;
    createdDate: number;
    modifiedDate: number;
    name?: string;
    tags: string[];
    _synced: number;

    #observables: ObservableArray<OCRPage>;
    pages: OCRPage[];

    constructor(public id: string) {
        super();
        // this.id = id;
    }

    static async createDocument(name?: string, pagesData?: PageData[], setRaw = false) {
        const docId = Date.now() + '';
        const doc = await documentsService.documentRepository.createDocument({ id: docId, name } as any);
        DEV_LOG && console.log('createDocument', doc);
        await doc.addPages(pagesData);
        return doc;
    }

    async addPage(pageData: PageData, index: number = this.pages.length) {
        const docId = this.id;
        const docData = documentsService.dataFolder.getFolder(docId);
        const { id, imagePath, sourceImagePath, image, ...otherPageData } = pageData;
        const pageId = id || Date.now() + '_' + index;
        // const page = new OCRPage(pageId, docId);
        const pageFileData = docData.getFolder(pageId);
        const attributes = { ...otherPageData, id: pageId, document_id: docId } as OCRPage;
        attributes.imagePath = path.join(pageFileData.path, 'image' + '.' + IMG_FORMAT);
        DEV_LOG && console.log('add page', attributes.imagePath, imagePath, sourceImagePath, image, otherPageData);
        if (imagePath) {
            const file = File.fromPath(imagePath);
            await file.copy(attributes.imagePath);
        } else if (image) {
            await new ImageSource(image).saveToFileAsync(attributes.imagePath, IMG_FORMAT, 100);
        } else {
            return;
        }
        if (sourceImagePath) {
            let baseName = sourceImagePath
                .split('/')
                .slice(-1)[0]
                .replace(/%[a-zA-Z\d]{2}/, '');
            if (!baseName.endsWith(IMG_FORMAT)) {
                baseName += '.' + IMG_FORMAT;
            }
            const actualSourceImagePath = path.join(pageFileData.path, baseName);
            const file = File.fromPath(sourceImagePath);
            await file.copy(actualSourceImagePath);
            attributes.sourceImagePath = actualSourceImagePath;
        }
        // we add 1000 to each pageIndex so that we can reorder them
        if (!attributes.pageIndex) {
            attributes.pageIndex = index + 1000;
        }
        const addedPage = await documentsService.pageRepository.createPage(attributes);
        // Object.assign(pageData, { ...pageData, pageIndex: pages.length + 1000 });

        //using saved image to disk
        if (this.pages) {
            this.pages.splice(index, 0, addedPage);
        } else {
            this.pages = [addedPage];
        }
        if (this.#observables) {
            this.#observables.splice(index, 0, addedPage);
        }
        this.notify({ eventName: 'pagesAdded', pages: [addedPage] });
    }

    async addPages(pagesData?: PageData[]) {
        DEV_LOG && console.log('addPages', JSON.stringify(pagesData));
        if (pagesData) {
            const docId = this.id;
            const docData = documentsService.dataFolder.getFolder(docId);
            const length = pagesData.length;
            const pages = [];
            const pageStartId = Date.now();
            for (let index = 0; index < length; index++) {
                const { id, imagePath, sourceImagePath, image, ...pageData } = pagesData[index];
                const pageId = id || pageStartId + '_' + index;
                // const page = new OCRPage(pageId, docId);
                const pageFileData = docData.getFolder(pageId);
                const attributes = { ...pageData, id: pageId, document_id: docId } as OCRPage;
                attributes.imagePath = path.join(pageFileData.path, 'image' + '.' + IMG_FORMAT);
                DEV_LOG && console.log('add page', attributes.imagePath, imagePath, sourceImagePath, image, JSON.stringify(pageData));
                if (imagePath) {
                    const file = File.fromPath(imagePath);
                    await file.copy(attributes.imagePath);
                } else if (image) {
                    await new ImageSource(image).saveToFileAsync(attributes.imagePath, IMG_FORMAT, 100);
                } else {
                    continue;
                }
                if (sourceImagePath) {
                    let baseName = sourceImagePath
                        .split('/')
                        .slice(-1)[0]
                        .replace(/%[a-zA-Z\d]{2}/, '');
                    if (!baseName.endsWith(IMG_FORMAT)) {
                        baseName += '.' + IMG_FORMAT;
                    }
                    const actualSourceImagePath = path.join(pageFileData.path, baseName);
                    const file = File.fromPath(sourceImagePath);
                    await file.copy(actualSourceImagePath);
                    attributes.sourceImagePath = actualSourceImagePath;
                }
                // we add 1000 to each pageIndex so that we can reorder them
                attributes.pageIndex = pages.length + 1000;
                // Object.assign(pageData, { ...pageData, pageIndex: pages.length + 1000 });

                //using saved image to disk
                pages.push(await documentsService.pageRepository.createPage(attributes));
            }
            DEV_LOG && console.log('addPages done', JSON.stringify(pages));
            if (this.pages) {
                this.pages.push(...pages);
            } else {
                this.pages = pages;
            }
            if (this.#observables) {
                this.#observables.push(...pages);
            }
            this.notify({ eventName: 'pagesAdded', pages });
        }
    }

    async removeFromDisk() {
        const docData = documentsService.dataFolder.getFolder(this.id);
        DEV_LOG && console.log('OCRDocument', 'removeFromDisk');
        return docData.remove();
    }

    async deletePage(pageIndex: number) {
        const removed = this.pages.splice(pageIndex, 1);
        if (this.#observables) {
            this.#observables.splice(pageIndex, 1);
        }
        await documentsService.pageRepository.delete(removed[0]);
        const docData = documentsService.dataFolder.getFolder(this.id);
        for (let index = 0; index < removed.length; index++) {
            const removedPage = removed[index];
            await docData.getFolder(removedPage.id).remove();
        }
        documentsService.notify({ eventName: 'documentPageDeleted', object: this, pageIndex });
        return this;
    }

    async updatePage(pageIndex, data: Partial<Page>, imageUpdated = false) {
        const page = this.pages[pageIndex];
        DEV_LOG && console.log('updatePage', pageIndex, data);
        if (page) {
            await documentsService.pageRepository.update(page, data);
            // we save the document so that the modifiedDate gets changed
            // no need to notify though
            await this.save();
            this.onPageUpdated(pageIndex, page, imageUpdated);
        }
    }
    async movePage(oldIndex: any, newIndex: any) {
        // first we need to find the new pageIndex
        let pageIndex;
        if (newIndex === 0) {
            pageIndex = this.pages[0].pageIndex - 1;
        } else {
            pageIndex = this.pages[newIndex].pageIndex + 1;
        }
        await this.updatePage(oldIndex, {
            pageIndex
        });

        const item = this.pages[oldIndex];
        this.pages.splice(oldIndex, 1);
        this.pages.splice(newIndex, 0, item);
        if (this.#observables) {
            const item = this.#observables.getItem(oldIndex);
            this.#observables.splice(oldIndex, 1);
            this.#observables.splice(newIndex, 0, item);
        }
    }
    onPageUpdated(pageIndex: number, page: OCRPage, imageUpdated = false) {
        page.notify({ eventName: 'updated', object: page });
        this.notify({ eventName: 'pageUpdated', object: page, pageIndex });
        documentsService.notify({ eventName: 'documentPageUpdated', object: this, pageIndex, imageUpdated });
    }
    #_observablesListeners: Function[] = [];
    getObservablePages() {
        if (!this.#observables) {
            const pages = this.pages;
            this.#observables = new ObservableArray(pages);
            const handler = (event: EventData & { pageIndex: number }) => {
                this.#observables.setItem(event.pageIndex, this.#observables.getItem(event.pageIndex));
            };
            this.#_observablesListeners.push(handler);
            this.on('pageUpdated', handler);
        }
        return this.#observables;
    }

    async save(data?: Partial<OCRDocument>, updateModifiedDate = true) {
        await documentsService.documentRepository.update(this, data, updateModifiedDate);
        documentsService.notify({ eventName: 'documentUpdated', object: documentsService, doc: this });
    }

    toString() {
        return JSON.stringify(this, (key, value) => (key.startsWith('_') ? undefined : value));
    }

    toJSONObject() {
        return JSON.parse(this.toString());
    }

    async updatePageCrop(pageIndex: number, quad: any, editingImage: ImageSource) {
        const page = this.pages[pageIndex];
        let images;
        if (__ANDROID__) {
            images = com.akylas.documentscanner.CustomImageAnalysisCallback.Companion.cropDocument(editingImage.android, JSON.stringify([quad]), page.transforms || '');
        } else {
            //TODO: implement iOS
        }
        const croppedImagePath = page.imagePath;
        await new ImageSource(images[0]).saveToFileAsync(croppedImagePath, IMG_FORMAT, 100);
        getImagePipeline().evictFromCache(croppedImagePath);
        await this.updatePage(
            pageIndex,
            {
                crop: quad
            },
            true
        );
        //we remove from cache so that everything gets updated
        recycleImages(images);
    }
    async updatePageTransforms(pageIndex: number, transforms: string, editingImage?: ImageSource) {
        const page = this.pages[pageIndex];
        if (!editingImage) {
            editingImage = await loadImage(page.sourceImagePath);
        }
        let images;
        if (__ANDROID__) {
            console.log('updatePageTransforms', page.crop, transforms);
            images = com.akylas.documentscanner.CustomImageAnalysisCallback.Companion.cropDocument(editingImage.android, JSON.stringify([page.crop]), transforms);
        } else {
            //TODO: implement iOS
        }
        const croppedImagePath = page.imagePath;
        await new ImageSource(images[0]).saveToFileAsync(croppedImagePath, IMG_FORMAT, 100);
        getImagePipeline().evictFromCache(croppedImagePath);
        await this.updatePage(
            pageIndex,
            {
                transforms
            },
            true
        );
        //we remove from cache so that everything gets updated
        recycleImages(images, editingImage);
    }
}

export interface Page {
    id: string;
    createdDate: number;
    modifiedDate?: number;
    document_id: string;

    transforms?: string;
    colorType?: string;
    colorMatrix?: number[];
    rotation: number;
    crop: number[];
    pageIndex: number;
    scale: number;
    width: number;
    height: number;
    sourceImagePath: string;
    imagePath: string;
}

export interface PageData extends ImageConfig, Partial<Page> {
    bitmap?;
    image?;
}

export class OCRPage extends Observable implements Page {
    id: string;
    createdDate: number;
    modifiedDate?: number;
    document_id: string;

    colorType?: string;
    colorMatrix?: number[];
    _colorMatrix?: string;

    rotation: number = 0;
    scale: number = 1;

    crop: number[];
    _crop: string;

    transforms?: string;

    pageIndex: number;
    width: number;
    height: number;
    sourceImagePath: string;
    imagePath: string;

    getImagePath() {
        return this.imagePath;
    }
    constructor(id: string, docId: string) {
        super();
        this.id = id;
        this.document_id = docId;
    }
}
