<script context="module" lang="ts">
    import { Canvas, CanvasView, LayoutAlignment, Paint, StaticLayout } from '@nativescript-community/ui-canvas';
    import { NativeViewElementNode } from 'svelte-native/dom';
    import { conditionalEvent } from '~/utils/svelte/ui';
    import { colors, fonts, systemFontScale } from '~/variables';
</script>

<script lang="ts">
    export let longPress: Function = null;
    export let text: string = null;
    export let progress: number = null;

    export let translateY = 100;
    // technique for only specific properties to get updated on store change
    $: ({ colorOnSurface, colorOnSurfaceVariant, colorPrimary, colorSurfaceInverse, colorOnSurfaceInverse } = $colors);
</script>

<gridlayout
    backgroundColor={colorSurfaceInverse}
    borderRadius={4}
    columns="*"
    elevation={6}
    margin="0 24 20 24"
    rows="auto,4"
    {translateY}
    verticalAlignment="bottom"
    {...$$restProps}
    on:tap
    use:conditionalEvent={{ condition: !!longPress, event: 'longPress', callback: longPress }}>
    <label color={colorOnSurfaceInverse} fontSize={14} fontWeight="500" maxLines={2} padding="14 16 14 16" {text} />
    <progress backgroundColor="transparent" maxValue={100} row={1} value={progress} visibility={progress !== null ? 'visible' : 'collapsed'} />
</gridlayout>
