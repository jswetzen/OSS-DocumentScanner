<script lang="ts">
    import { Application, OrientationChangedEventData } from '@nativescript/core';
    import { Img } from '@nativescript-community/ui-image';
    import { Pager } from '@nativescript-community/ui-pager';
    import { onDestroy, onMount } from 'svelte';
    import { Template } from 'svelte-native/components';
    import { NativeViewElementNode } from 'svelte-native/dom';
    import CActionBar from '~/components/common/CActionBar.svelte';
    import RotableImageView from '~/components/common/RotableImageView.svelte';
    import { showError } from '~/utils/error';
    import { share } from '~/utils/share';
    import { colors } from '~/variables';

    // technique for only specific properties to get updated on store change
    $: ({ colorPrimary, colorOnBackground } = $colors);

    export let keepScreenAwake = false;
    export let refreshOnOrientationChange = false;
    export let screenBrightness = -1;
    export let startPageIndex: number = 0;
    export let backgroundColor = 'black';
    export let labelColor = 'white';
    export let statusBarStyle: any = 'dark';
    export let actionBarStyle: any = backgroundColor === 'black' ? 'black' : '';
    export let images: { image; subtitle?; sharedTransitionTag?; colorMatrix?; colorType?; margin?; rotation? }[];
    let pager: NativeViewElementNode<Pager>;
    let imageFunctionArg = Application.orientation();

    let currentIndex = startPageIndex;
    const firstItem = images[currentIndex];

    // let currentImageSrc = firstItem.image;
    // let currentImageRotation = firstItem.rotation;
    // let currentImageColorMatrix = firstItem.colorMatrix || getColorMatrix(firstItem.colorType);

    function onSelectedIndex(event) {
        currentIndex = event.object.selectedIndex;
        const item = images[currentIndex];
        // currentImageSrc = item.image;
        // currentImageRotation = item.rotation;
        // currentImageColorMatrix = item.colorMatrix || getColorMatrix(item.colorType);
    }
    // function onFirstLayout(item, e) {
    //     console.log('onFirstLayout');
    //     if (item.rotation % 180 === 90) {
    //         const currentWidth = layout.toDeviceIndependentPixels(e.object.getMeasuredWidth());
    //         const currentHeight = layout.toDeviceIndependentPixels(e.object.getMeasuredHeight());
    //         const delta = item.rotation % 180 === 0 ? 0 : (currentWidth - currentHeight) / 2;
    //         Object.assign(e.object, {
    //             translateX: delta,
    //             translateY: -delta,
    //             width: currentHeight,
    //             height: currentWidth
    //         });
    //     }
    // }

    // $: {
    //     colorType = document.pages[currentIndex].colorType || 0;
    // }
    // async function setColorType(type: number) {
    //     colorType = type;
    //     try {
    //         await document.updatePage(currentIndex, {
    //             colorType: type
    //             // colorMatrix: getColorMatrix(type)
    //         });
    //         // pages.setItem(currentIndex, current);
    //     } catch (err) {
    //         showError(err);
    //     }
    // }

    function getCurrentImageView() {
        return pager?.nativeView?.getChildView(currentIndex)?.getViewById<Img>('imageView');
    }

    async function shareItem(item) {
        try {
            await share({ file: await item.imagePath });
        } catch (error) {
            showError(error);
        }
    }

    function onOrientationChanged(event: OrientationChangedEventData) {
        imageFunctionArg = event.newValue;
        // setTimeout(() => {
        if (refreshOnOrientationChange) {
            pager?.nativeElement.refresh();
        }
        // }, 1000);
    }

    onMount(() => {
        Application.on('orientationChanged', onOrientationChanged);
    });
    onDestroy(() => {
        Application.off('orientationChanged', onOrientationChanged);
    });
</script>

<page actionBarHidden={true} {backgroundColor} {keepScreenAwake} {screenBrightness} screenOrientation="all" statusBarColor={backgroundColor} {statusBarStyle}>
    <gridlayout rows="auto,*">
        <!-- <image blurRadius={20} colorMatrix={currentImageColorMatrix} fadeDuration={100} imageRotation={currentImageRotation} opacity={0.3} rowSpan={2} src={currentImageSrc} stretch="aspectFill" /> -->

        <pager bind:this={pager} items={images} preserveIndexOnItemsChange={true} rowSpan={2} selectedIndex={startPageIndex} transformers="zoomOut" on:selectedIndexChange={onSelectedIndex}>
            <Template let:item>
                <gridlayout rows="*,auto" width="100%">
                    <RotableImageView id="imageView" {imageFunctionArg} {item} margin={item.margin} sharedTransitionTag={item.sharedTransitionTag} zoomable={true} />
                    <label
                        color={labelColor}
                        fontSize={30}
                        fontWeight="bold"
                        paddingTop={5}
                        row={1}
                        sharedTransitionTag={item.labelSharedTransitionTag}
                        text={item.subtitle}
                        textAlignment="center"
                        verticalAlignment="bottom"
                        visibility={item.subtitle ? 'visible' : 'hidden'} />
                </gridlayout>
            </Template>
        </pager>

        <CActionBar backgroundColor="transparent" buttonsDefaultVisualState={actionBarStyle} titleProps={{ autoFontSize: true, padding: 0 }} />
    </gridlayout>
</page>
