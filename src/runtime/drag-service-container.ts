import { EditorView } from '@codemirror/view';
import { LineParsingService } from '../domain/markdown/line-parsing-service';
import { GeometryCalculator } from '../platform/codemirror/geometry';
import { ContainerPolicyService } from '../domain/rules/container-policy-service';
import { TextMutationPolicy } from '../domain/mutation/text-mutation-policy';
import { DragSourceResolver } from '../drag/source/source-resolver';
import { DropPlannerSharedDeps } from '../drag/drop/drop-planner';
import { BlockMoverDeps } from '../drag/move/block-mover-deps';

/**
 * Groups the stateless/low-state core services that many subsystems depend on.
 * Created once per ViewPlugin lifetime and threaded through as a single object.
 */
export class DragDropServiceContainer {
    readonly lineParsing: LineParsingService;
    readonly geometry: GeometryCalculator;
    readonly containerPolicy: ContainerPolicyService;
    readonly textMutation: TextMutationPolicy;
    readonly dragSource: DragSourceResolver;

    constructor(readonly view: EditorView) {
        this.dragSource = new DragSourceResolver(view);
        this.lineParsing = new LineParsingService(view);
        this.geometry = new GeometryCalculator(view, this.lineParsing);
        this.containerPolicy = new ContainerPolicyService(view);
        this.textMutation = new TextMutationPolicy(this.lineParsing);
    }

    createDropPlannerDeps(
        hooks?: Pick<DropPlannerSharedDeps, 'onDragTargetEvaluated' | 'recordPerfDuration' | 'incrementPerfCounter'>
    ): DropPlannerSharedDeps {
        const sharedDeps = this.createSharedMutationPolicyDeps();
        return {
            ...sharedDeps,
            getBlockInfoForEmbed: (el) => this.dragSource.getBlockInfoForEmbed(el),
            getIndentUnitWidthForDoc: (doc) => this.textMutation.getIndentUnitWidthForDoc(doc),
            getLineRect: (ln) => this.geometry.getLineRect(ln),
            getInsertionAnchorY: (ln) => this.geometry.getInsertionAnchorY(ln),
            getLineIndentPosByWidth: (ln, w) => this.geometry.getLineIndentPosByWidth(ln, w),
            getBlockRect: (s, e) => this.geometry.getBlockRect(s, e),
            ...hooks,
        };
    }

    createBlockMoverDeps(): Omit<BlockMoverDeps, 'view'> {
        return {
            parseLineWithQuote: (line) => this.textMutation.parseLineWithQuote(line),
            resolveDropRuleAtInsertion: (src, ln, opts) => this.containerPolicy.resolveDropRuleAtInsertion(src, ln, opts),
            getListContext: (doc, ln) => this.textMutation.getListContext(doc, ln),
            getIndentUnitWidth: (sample) => this.textMutation.getIndentUnitWidth(sample),
            buildInsertText: (doc, src, ln, content, listIntent) =>
                this.textMutation.buildInsertText(doc, src, ln, content, listIntent),
        };
    }

    private createSharedMutationPolicyDeps(): Pick<
        DropPlannerSharedDeps,
        'parseLineWithQuote' | 'getAdjustedTargetLocation' | 'resolveDropRuleAtInsertion' | 'getListContext' | 'getIndentUnitWidth'
    > {
        return {
            parseLineWithQuote: (line) => this.textMutation.parseLineWithQuote(line),
            getAdjustedTargetLocation: (ln, opts) => this.geometry.getAdjustedTargetLocation(ln, opts),
            resolveDropRuleAtInsertion: (src, ln, opts) => this.containerPolicy.resolveDropRuleAtInsertion(src, ln, opts),
            getListContext: (doc, ln) => this.textMutation.getListContext(doc, ln),
            getIndentUnitWidth: (sample) => this.textMutation.getIndentUnitWidth(sample),
        };
    }
}
