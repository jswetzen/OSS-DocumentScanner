<script context="module" lang="ts">
    import SqlQuery from '@akylas/kiss-orm/dist/Queries/SqlQuery';
    import { request } from '@nativescript-community/perms';
    import { Canvas, CanvasView, LayoutAlignment, Paint, StaticLayout } from '@nativescript-community/ui-canvas';
    import { CollectionView } from '@nativescript-community/ui-collectionview';
    import { Img } from '@nativescript-community/ui-image';
    import { createNativeAttributedString } from '@nativescript-community/ui-label';
    import { LottieView } from '@nativescript-community/ui-lottie';
    import { showBottomSheet } from '@nativescript-community/ui-material-bottomsheet/svelte';
    import { confirm } from '@nativescript-community/ui-material-dialogs';
    import { VerticalPosition } from '@nativescript-community/ui-popover';
    import { showPopover } from '@nativescript-community/ui-popover/svelte';
    import { AnimationDefinition, Application, ApplicationSettings, Color, EventData, NavigatedData, ObservableArray, Page, PageTransition, SharedTransition, StackLayout } from '@nativescript/core';
    import { AndroidActivityBackPressedEventData, AndroidActivityNewIntentEventData } from '@nativescript/core/application/application-interfaces';
    import dayjs from 'dayjs';
    import { filesize } from 'filesize';
    import { onDestroy, onMount } from 'svelte';
    import { navigate, showModal } from 'svelte-native';
    import { Template } from 'svelte-native/components';
    import { NativeViewElementNode } from 'svelte-native/dom';
    import Camera from '~/components/camera/Camera.svelte';
    import CActionBar from '~/components/common/CActionBar.svelte';
    import PageIndicator from '~/components/common/PageIndicator.svelte';
    import RotableImageView from '~/components/common/RotableImageView.svelte';
    import SelectedIndicator from '~/components/common/SelectedIndicator.svelte';
    import SyncIndicator from '~/components/common/SyncIndicator.svelte';
    import { l, lc } from '~/helpers/locale';
    import { getRealTheme, onThemeChanged } from '~/helpers/theme';
    import { OCRDocument } from '~/models/OCRDocument';
    import { documentsService } from '~/services/documents';
    import { syncService } from '~/services/sync';
    import { showError } from '~/utils/error';
    import { fade } from '~/utils/svelte/ui';
    import { detectOCR, importAndScanImage, importAndScanImageFromUris, showImagePopoverMenu, showPDFPopoverMenu, showPopoverMenu, showSnackMessage } from '~/utils/ui';
    import { colors, screenWidthDips, systemFontScale } from '~/variables';

    const textPaint = new Paint();
</script>

<script lang="ts">
    // technique for only specific properties to get updated on store change
    let { colorPrimaryContainer, colorOnBackground } = $colors;
    $: ({
        colorSurfaceContainerHigh,
        colorOnBackground,
        colorSurfaceContainerLow,
        colorOnSecondary,
        colorSurfaceContainer,
        colorOnSurfaceVariant,
        colorOutline,
        colorOutlineVariant,
        colorSurface,
        colorPrimaryContainer,
        colorOnPrimaryContainer,
        colorError
    } = $colors);

    interface Item {
        doc: OCRDocument;
        selected: boolean;
    }
    let documents: ObservableArray<Item> = null;
    let nbDocuments: number = 0;
    let showNoDocument = false;
    let page: NativeViewElementNode<Page>;
    let collectionView: NativeViewElementNode<CollectionView>;
    let lottieView: NativeViewElementNode<LottieView>;
    let fabHolder: NativeViewElementNode<StackLayout>;

    let viewStyle: string = ApplicationSettings.getString('documents_list_view_style', 'expanded');
    $: condensed = viewStyle === 'condensed';
    let syncEnabled = syncService.enabled;
    let syncRunning = false;
    // let items: ObservableArray<{
    //     doc: OCRDocument; selected: boolean
    // }> = null;

    async function refresh() {
        try {
            syncEnabled = syncService.enabled;
            DEV_LOG && console.log('syncEnabled', syncEnabled);
            const r = await documentsService.documentRepository.search({
                orderBy: SqlQuery.createFromTemplateString`id DESC`
                // , postfix: SqlQuery.createFromTemplateString`LIMIT 50`
            });
            // const r = await OCRDocument.find({
            //     order: {
            //         id: 'DESC'
            //     },
            //     take: 50
            // });
            documents = new ObservableArray(
                r.map((doc) => ({
                    doc,
                    selected: false
                }))
            );
            updateNoDocument();

            // if (DEV_LOG) {
            //     const component = (await import('~/components/PDFPreview.svelte')).default;
            //     await showModal({
            //         page: component,
            //         animated: true,
            //         fullscreen: true,
            //         props: {
            //             documents: [documents.getItem(0).doc]
            //         }
            //     });
            // }
            // await Promise.all(r.map((d) => d.pages[0]?.imagePath));
        } catch (error) {
            console.error(error, error.stack);
        }
    }

    function updateNoDocument() {
        nbDocuments = documents.length;
        showNoDocument = nbDocuments === 0;
    }
    function onDocumentAdded(event: EventData & { doc }) {
        documents.unshift({
            doc: event.doc,
            selected: false
        } as Item);
        updateNoDocument();
        DEV_LOG && console.log('onDocumentAdded', nbDocuments);
    }
    function onDocumentUpdated(event: EventData & { doc: OCRDocument }) {
        let index = -1;
        documents.some((d, i) => {
            if (d.doc.id === event.doc.id) {
                index = i;
                return true;
            }
        });
        DEV_LOG && console.log('onDocumentUpdated', event.doc._synced, event.doc, index, event.doc.pages.length);
        if (index >= 0) {
            const item = documents.getItem(index);
            item.doc = event.doc;
            documents.setItem(index, item);
        }
    }
    function onDocumentsDeleted(event: EventData & { documents: OCRDocument[] }) {
        for (let index = documents.length - 1; index >= 0; index--) {
            if (event.documents.indexOf(documents.getItem(index).doc) !== -1) {
                documents.splice(index, 1);
                nbSelected -= 1;
            }
        }
        updateNoDocument();
    }
    function getImageView(index: number) {
        return collectionView?.nativeView?.getViewForItemAtIndex(index)?.getViewById<Img>('imageView');
    }

    function onDocumentPageUpdated(event: EventData & { pageIndex: number; imageUpdated: boolean }) {
        // let index = -1;
        DEV_LOG && console.log('onDocumentPageUpdated', event.pageIndex, event.imageUpdated);
        const document = event.object as OCRDocument;
        if (event.pageIndex === 0) {
            const index = documents.findIndex((d) => d.doc === document);
            // documents.some((d, i) => {
            //     if (d.doc === (event.object as any)) {
            //         index = i;
            //         return true;
            //     }
            // });
            if (index >= 0) {
                documents.setItem(index, documents.getItem(index));
                if (!!event.imageUpdated) {
                    getImageView(index)?.updateImageUri();
                }
            }
        }
    }
    function onSyncState(event: EventData & { state: 'running' | 'finished' }) {
        syncRunning = event.state === 'running';
        DEV_LOG && console.log('syncState', event.state, syncRunning);
    }

    function onSnackMessageAnimation({ animationArgs }: EventData & { animationArgs: AnimationDefinition[] }) {
        if (fabHolder) {
            const snackAnimation = animationArgs[0];
            animationArgs.push({
                target: fabHolder.nativeView,
                translate: { x: 0, y: snackAnimation.translate.y === 0 ? -70 : 0 },
                duration: snackAnimation.duration
            });
        }
    }

    onMount(() => {
        Application.on('snackMessageAnimation', onSnackMessageAnimation);
        if (__ANDROID__) {
            const intent = Application.android['startIntent'];
            Application.android.on(Application.android.activityBackPressedEvent, onAndroidBackButton);
            Application.android.on(Application.android.activityNewIntentEvent, onAndroidNewItent);
            if (intent) {
                onAndroidNewItent({ intent } as any);
            }
        }
        documentsService.on('documentPageUpdated', onDocumentPageUpdated);
        documentsService.on('documentPageDeleted', onDocumentPageUpdated);
        documentsService.on('documentAdded', onDocumentAdded);
        documentsService.on('documentUpdated', onDocumentUpdated);
        documentsService.on('documentsDeleted', onDocumentsDeleted);
        syncService.on('syncState', onSyncState);
        syncService.on('state', refresh);
        // refresh();
    });
    onDestroy(() => {
        Application.off('snackMessageAnimation', onSnackMessageAnimation);
        if (__ANDROID__) {
            Application.android.off(Application.android.activityBackPressedEvent, onAndroidBackButton);
            Application.android.off(Application.android.activityNewIntentEvent, onAndroidNewItent);
        }
        documentsService.on('documentPageDeleted', onDocumentPageUpdated);
        documentsService.off('documentPageUpdated', onDocumentPageUpdated);
        documentsService.off('documentUpdated', onDocumentUpdated);
        documentsService.off('documentAdded', onDocumentAdded);
        documentsService.off('documentsDeleted', onDocumentsDeleted);
        syncService.off('syncState', onSyncState);
    });

    const showActionButton = !ApplicationSettings.getBoolean('startOnCam', START_ON_CAM);
    async function goToView(doc: OCRDocument) {
        const page = (await import('~/components/view/DocumentView.svelte')).default;
        return navigate({
            page,
            transition: __ANDROID__ ? SharedTransition.custom(new PageTransition(300, null, 10)) : undefined,
            props: {
                document: doc
            }
        });
    }
    async function onStartCam() {
        try {
            const result = await request('camera');
            if (result[0] !== 'authorized') {
                throw new Error(lc('camera_permission_needed'));
            }
            const document: OCRDocument = await showModal({
                page: Camera,
                fullscreen: true
            });
            if (document) {
                if (document.pages.length === 1) {
                    const component = (await import('~/components/edit/DocumentEdit.svelte')).default;
                    navigate({
                        page: component,
                        props: {
                            document
                        }
                    });
                } else {
                    await goToView(document);
                }
            }
            // const documentScanner = new DocumentScanner({
            //     showColorFilters: false,
            //     maxNumSimultaneousDocuments: 1
            // });

            // const result = await documentScanner.startScan();
            // if (result?.length) {
            //     const document = await OCRDocument.createDocument(
            //         dayjs().format('L LT'),
            //         __ANDROID__ ? result.map((s) => ({ ...s, colorType: 1, imagePath: s.imagePath.replace('file://', '') })) : result.map((s) => ({ ...s, colorType: 1 }))
            //     );
            //     document.save();
            //     documentsService.notify({ eventName: 'documentAdded', object: this, doc: document });
            //     // const images = data.nativeDatas.images.map((image, i) => ({ image, mat: data.nativeDatas.mats[i] }));
            //     const PDFView = (await import('~/components/DocumentView.svelte')).default;
            //     navigate({
            //         page: PDFView,
            //         transition: SharedTransition.custom(new PageTransition(300)),
            //         props: {
            //             document: document
            //         }
            //     });
            // }
        } catch (error) {
            showError(error);
        }
        // showModal({
        //     page: Camera,
        //     fullscreen: true
        // });
    }

    async function importDocument() {
        try {
            const doc = await importAndScanImage();
            if (!doc) {
                return;
            }
            const component = doc.pages.length > 1 ? (await import('~/components/view/DocumentView.svelte')).default : (await import('~/components/edit/DocumentEdit.svelte')).default;
            navigate({
                page: component,
                props: {
                    document: doc
                }
            });
        } catch (error) {
            showError(error);
        }
    }
    async function onNavigatedTo(e: NavigatedData) {
        if (!e.isBackNavigation) {
            if (documentsService.started) {
                refresh();
            } else {
                documentsService.once('started', refresh);
            }
        }
    }
    let nbSelected = 0;
    function selectItem(item: Item) {
        if (!item.selected) {
            documents.some((d, index) => {
                if (d === item) {
                    nbSelected++;
                    d.selected = true;
                    documents.setItem(index, d);
                    return true;
                }
            });
        }
    }
    function unselectItem(item: Item) {
        if (item.selected) {
            documents.some((d, index) => {
                if (d === item) {
                    nbSelected--;
                    d.selected = false;
                    documents.setItem(index, d);
                    return true;
                }
            });
        }
    }
    function unselectAll() {
        nbSelected = 0;
        documents.splice(0, documents.length, ...documents.map((i) => ({ doc: i.doc, selected: false })));
        // documents?.forEach((d, index) => {
        //         d.selected = false;
        //         documents.setItem(index, d);
        //     });
        // refresh();
    }
    let ignoreTap = false;
    function onItemLongPress(item: Item, event?) {
        // console.log('onItemLongPress', event && event.ios && event.ios.state);
        if (event && event.ios && event.ios.state !== 1) {
            return;
        }
        if (event && event.ios) {
            ignoreTap = true;
        }
        // console.log('onItemLongPress', item, Object.keys(event));
        if (item.selected) {
            unselectItem(item);
        } else {
            selectItem(item);
        }
    }
    async function onItemTap(item: Item) {
        try {
            if (ignoreTap) {
                ignoreTap = false;
                return;
            }
            // console.log('onItemTap', event && event.ios && event.ios.state, selectedSessions.length);
            if (nbSelected > 0) {
                onItemLongPress(item);
            } else {
                await goToView(item.doc);
            }
        } catch (error) {
            showError(error);
        }
    }
    function onAndroidBackButton(data: AndroidActivityBackPressedEventData) {
        if (__ANDROID__) {
            if (nbSelected > 0) {
                data.cancel = true;
                unselectAll();
            }
        }
    }
    async function onAndroidNewItent(event: AndroidActivityNewIntentEventData) {
        if (__ANDROID__) {
            try {
                const uris = [];
                const intent = event.intent as android.content.Intent;
                DEV_LOG && console.log('onAndroidNewItent', intent.getAction());
                switch (intent.getAction()) {
                    case 'android.intent.action.SEND':
                        const imageUri = intent.getParcelableExtra('android.intent.extra.STREAM') as android.net.Uri;
                        if (imageUri) {
                            uris.push(imageUri.toString());
                        }
                        break;
                    case 'android.intent.action.SEND_MULTIPLE':
                        const imageUris = intent.getParcelableArrayListExtra('android.intent.extra.STREAM') as java.util.ArrayList<android.net.Uri>;
                        if (imageUris) {
                            for (let index = 0; index < imageUris.size(); index++) {
                                uris.push(imageUris.get(index).toString());
                            }
                        }
                }
                if (uris.length) {
                    const doc = await importAndScanImageFromUris(uris);
                    if (!doc) {
                        return;
                    }
                    const component = doc.pages.length > 1 ? (await import('~/components/view/DocumentView.svelte')).default : (await import('~/components/edit/DocumentEdit.svelte')).default;
                    navigate({
                        page: component,
                        props: {
                            document: doc
                        }
                    });
                }
            } catch (error) {
                showError(error);
            }
        }
    }
    async function fullscreenSelectedDocuments() {
        const component = (await import('~/components/FullScreenImageViewer.svelte')).default;
        navigate({
            page: component,
            // transition: __ANDROID__ ? SharedTransition.custom(new PageTransition(300, undefined, 10), {}) : undefined,
            props: {
                images: getSelectedDocuments().reduce((acc, doc) => {
                    doc.pages.forEach((page) =>
                        acc.push({
                            // sharedTransitionTag: `document_${doc.id}_${page.id}`,
                            name: page.name || doc.name,
                            image: page.imagePath,
                            ...page
                        })
                    );
                    return acc;
                }, []),
                startPageIndex: 0
            }
        });
    }

    function getSelectedDocuments() {
        const selected = [];
        documents.forEach((d, index) => {
            if (d.selected) {
                selected.push(d.doc);
            }
        });
        return selected;
    }
    async function deleteSelectedDocuments() {
        if (nbSelected > 0) {
            try {
                const result = await confirm({
                    title: lc('delete'),
                    message: lc('confirm_delete_documents', nbSelected),
                    okButtonText: lc('delete'),
                    cancelButtonText: lc('cancel')
                });
                if (result) {
                    await documentsService.deleteDocuments(getSelectedDocuments());
                }
            } catch (error) {
                showError(error);
            }
        }
    }
    async function showSettings() {
        try {
            const Settings = (await import('~/components/settings/Settings.svelte')).default;
            navigate({ page: Settings });
        } catch (error) {
            showError(error);
        }
    }
    async function selectViewStyle(event) {
        try {
            // const options = Object.keys(OPTIONS[option]).map((k) => ({ ...OPTIONS[option][k], id: k }));
            await showPopoverMenu({
                options: [
                    { id: 'default', name: lc('expanded') },
                    { id: 'condensed', name: lc('condensed') }
                ],
                anchor: event.object,
                onClose: (item) => {
                    viewStyle = item.id;
                    ApplicationSettings.setString('documents_list_view_style', viewStyle);
                }
            });
        } catch (error) {
            showError(error);
        }
    }
    async function syncDocuments() {
        try {
            if (!syncEnabled) {
                return showSyncSettings();
            }
            await syncService.syncDocuments(true);
        } catch (error) {
            showError(error);
        }
    }
    async function showSyncSettings() {
        try {
            const WebdavConfig = (await import('~/components/webdav/WebdavConfig.svelte')).default;
            await showBottomSheet({
                parent: this,
                skipCollapsedState: true,
                view: WebdavConfig,
                ignoreTopSafeArea: true
            });
        } catch (error) {
            showError(error);
        }
    }

    // function setLottieColor(colorStr) {
    //     if (!colorStr) {
    //         return;
    //     }
    //     const color = new Color(colorStr);
    //     // const nativeKeyPath: any[] = Array.create(java.lang.String, 2);
    //     // nativeKeyPath[0] = 'trans';
    //     // nativeKeyPath[1] = '*';
    //     // const result = lottieView.nativeView.resolveKeyPath(new com.airbnb.lottie.model.KeyPath(nativeKeyPath));
    //     // console.log('resolveKeyPath', result);
    //     // lottieView.setColorValueDelegateForKeyPath(color, ['Rectangle','Rectangle', 'Fill 1']);
    //     // lottieView.setColor(color, ['full', '**']);
    //     // lottieView.setColorValueDelegateForKeyPath(color, ['full', 'Rectangle 3']);
    //     // lottieView.setColor(color, ['bottom-grad', '**']);
    //     // lottieView.setColor(color, ['trans', 'Rectangle', 'Rectangle', 'Fill 1']);
    //     // lottieView.setColor(color, ['full', 'Rectangle 3', '**']);
    //     lottieView?.nativeView?.setColor(color, ['**']);
    // }

    // $: setLottieColor(colorPrimaryContainer);

    // function onLottieLoaded({ object: lottieView }: { object: LottieView }) {
    //     try {
    //         setLottieColor(colorPrimaryContainer);
    //     } catch (error) {
    //         showError(error);
    //     }
    // }
    // function getSize(item: Item) {
    //     return filesize(item.doc.pages.reduce((acc, v) => acc + v.size, 0));
    // }
    function refreshCollectionView() {
        collectionView?.nativeView?.refresh();
    }
    onThemeChanged(refreshCollectionView);

    // let lottieLightColor = new Color(colorPrimaryContainer);
    // const
    let lottieDarkFColor;
    let lottieLightColor;
    $: {
        if (colorPrimaryContainer) {
            lottieDarkFColor = new Color(colorPrimaryContainer);
            const realTheme = getRealTheme();
            if (realTheme === 'light') {
                lottieLightColor = new Color(colorPrimaryContainer).darken(10);
            } else {
                lottieLightColor = new Color(colorPrimaryContainer).lighten(10);
            }
        }
    }
    async function showPDFPopover(event) {
        try {
            await showPDFPopoverMenu(getSelectedDocuments(), event.object);
        } catch (err) {
            showError(err);
        }
    }

    async function showImageExportPopover(event) {
        try {
            await showImagePopoverMenu(
                getSelectedDocuments().reduce((acc, doc) => {
                    acc.push(...doc.pages);
                    return acc;
                }, []),
                event.object
            );
        } catch (err) {
            showError(err);
        }
    }
    function getItemImageHeight(viewStyle) {
        return condensed ? 44 : 94;
    }
    function getItemRowHeight(viewStyle) {
        return condensed ? 80 : 150;
    }
    function getImageMargin(viewStyle) {
        switch (viewStyle) {
            case 'condensed':
                return 0;

            default:
                return 10;
        }
    }

    $: textPaint.color = colorOnBackground || 'black';
    $: textPaint.textSize = (condensed ? 11 : 14) * $systemFontScale;

    function onCanvasDraw(item, { canvas, object }: { canvas: Canvas; object: CanvasView }) {
        const w = canvas.getWidth();
        const h = canvas.getHeight();
        // const w2 = w / 2;
        // const h2 = h / 2;
        const dx = 10 + getItemImageHeight(viewStyle) * $systemFontScale + 16;
        textPaint.color = colorOnSurfaceVariant;
        canvas.drawText(filesize(item.doc.pages.reduce((acc, v) => acc + v.size, 0)), dx, h - (condensed ? 0 : 16) - 10, textPaint);
        textPaint.color = colorOnBackground;
        const topText = createNativeAttributedString({
            spans: [
                {
                    fontSize: 16 * $systemFontScale,
                    fontWeight: 'bold',
                    lineBreak: 'end',
                    lineHeight: 18 * $systemFontScale,
                    text: item.doc.name
                },
                {
                    color: colorOnSurfaceVariant,
                    lineHeight: (condensed ? 14 : 26) * $systemFontScale,
                    text: '\n' + dayjs(item.doc.createdDate).format('L LT')
                }
            ]
        });
        const staticLayout = new StaticLayout(topText, textPaint, w, LayoutAlignment.ALIGN_NORMAL, 1, 0, true, 'end');
        canvas.translate(dx, 4 + 10);
        staticLayout.draw(canvas);
        // canvas.drawText(text, w2, w2+ textSize/3, iconPaint);
    }

    async function showOptions(event) {
        const options = new ObservableArray([
            { id: 'share', name: lc('share'), icon: 'mdi-share-variant' },
            { id: 'fullscreen', name: lc('show_fullscreen_images'), icon: 'mdi-fullscreen' },
            { id: 'ocr', name: lc('ocr_document'), icon: 'mdi-text-recognition' },
            { id: 'delete', name: lc('delete'), icon: 'mdi-delete', color: colorError }
        ] as any);
        return showPopoverMenu({
            options,
            anchor: event.object,
            vertPos: VerticalPosition.BELOW,

            onClose: async (item) => {
                switch (item.id) {
                    case 'share':
                        showImageExportPopover(event);
                        break;
                    case 'fullscreen':
                        fullscreenSelectedDocuments();
                        break;
                    case 'ocr':
                        detectOCR(getSelectedDocuments());
                        break;
                    case 'delete':
                        deleteSelectedDocuments();
                        break;
                }
            }
        });
    }
</script>

<page bind:this={page} id="documentList" actionBarHidden={true} on:navigatedTo={onNavigatedTo}>
    <gridlayout rows="auto,*">
        <!-- {/if} -->
        <collectionView bind:this={collectionView} items={documents} paddingBottom={88} row={1} rowHeight={getItemRowHeight(viewStyle) * $systemFontScale}>
            <Template let:item>
                <canvasview
                    backgroundColor={colorSurfaceContainerHigh}
                    borderRadius={12}
                    fontSize={14 * $systemFontScale}
                    margin={8}
                    padding={10}
                    rippleColor={colorSurface}
                    on:tap={() => onItemTap(item)}
                    on:longPress={(e) => onItemLongPress(item, e)}
                    on:draw={(e) => onCanvasDraw(item, e)}>
                    <RotableImageView
                        id="imageView"
                        borderRadius={12}
                        horizontalAlignment="left"
                        item={item.doc.pages[0]}
                        marginBottom={getImageMargin(viewStyle)}
                        marginTop={getImageMargin(viewStyle)}
                        sharedTransitionTag={`document_${item.doc.id}_${item.doc.pages[0].id}`}
                        stretch="aspectFill"
                        width={getItemImageHeight(viewStyle) * $systemFontScale} />
                    <SelectedIndicator horizontalAlignment="left" margin={2} selected={item.selected} />
                    <SyncIndicator selected={item.doc._synced === 1} visible={syncEnabled} />
                    <PageIndicator horizontalAlignment="right" text={item.doc.pages.length} />
                </canvasview>
            </Template>
        </collectionView>
        {#if showNoDocument}
            <gridlayout marginBottom={150} paddingLeft={16} paddingRight={16} row={1} rows="auto,auto" verticalAlignment="center" transition:fade={{ duration: 200 }}>
                <lottie
                    bind:this={lottieView}
                    autoPlay={true}
                    keyPathColors={{
                        'background|**': lottieDarkFColor,
                        'full|**': lottieLightColor,
                        'scanner|**': lottieLightColor,
                        'lines|**': lottieDarkFColor
                    }}
                    loop={true}
                    marginBottom={20}
                    src="~/assets/lottie/scanning.lottie"
                    width="80%" />
                <label color={colorOnSurfaceVariant} fontSize={19} text={lc('no_document_yet')} textAlignment="center" textWrap={true} verticalAlignment="bottom" width="80%" />
            </gridlayout>
        {/if}
        {#if showActionButton}
            <stacklayout bind:this={fabHolder} horizontalAlignment="right" iosIgnoreSafeArea={true} row={1} verticalAlignment="bottom">
                <mdbutton class="small-fab" horizontalAlignment="center" text="mdi-image-plus" on:tap={importDocument} />
                <mdbutton id="fab" class="fab" margin="8 16 16 16" text="mdi-camera" on:tap={onStartCam} />
            </stacklayout>
        {/if}

        <CActionBar title={l('documents')}>
            <mdbutton
                class="actionBarButton"
                defaultVisualState={syncEnabled ? 'normal' : 'disabled'}
                isEnabled={!syncRunning}
                text="mdi-sync"
                variant="text"
                on:tap={syncDocuments}
                on:longPress={showSyncSettings} />
            <mdbutton class="actionBarButton" text="mdi-view-dashboard" variant="text" on:tap={selectViewStyle} />
            <mdbutton class="actionBarButton" text="mdi-cogs" variant="text" on:tap={showSettings} />
        </CActionBar>
        <!-- {#if nbSelected > 0} -->
        {#if nbSelected > 0}
            <CActionBar forceCanGoBack={true} onGoBack={unselectAll} title={l('selected', nbSelected)} titleProps={{ maxLines: 1, autoFontSize: true }}>
                <!-- <mdbutton class="actionBarButton" text="mdi-share-variant" variant="text" visibility={nbSelected ? 'visible' : 'collapsed'} on:tap={showImageExportPopover} /> -->
                <mdbutton class="actionBarButton" text="mdi-file-pdf-box" variant="text" on:tap={showPDFPopover} />
                <mdbutton class="actionBarButton" text="mdi-dots-vertical" variant="text" on:tap={showOptions} />
            </CActionBar>
        {/if}
    </gridlayout>
</page>
