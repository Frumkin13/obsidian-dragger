import { EditorView } from '@codemirror/view';
import { LineParsingService } from './parser/line-parsing-service';
import { GeometryCalculator } from './geometry/geometry-calculator';
import { ContainerPolicyService } from '../model/container/container-policy-service';
import { TextMutationPolicy } from '../model/mutation/text-mutation-policy';
import { DragSourceResolver } from './state/drag-source-resolver';
import { DropTargetCalculatorDeps } from './geometry/collision-detector';
import { BlockMoverDeps } from '../../features/drag-operation/strategies/standard-move';

/**
 * Groups the stateless/low-state core services that many subsystems depend on.
 * Created once per ViewPlugin lifetime and threaded through as a single object.
 */
export class ServiceContainer {
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

    createDropTargetCalculatorDeps(
        hooks?: Pick<DropTargetCalculatorDeps, 'onDragTargetEvaluated' | 'recordPerfDuration' | 'incrementPerfCounter'>
    ): DropTargetCalculatorDeps {
        const sharedDeps = this.createSharedMutationPolicyDeps();
        return {
            ...sharedDeps,
            getBlockInfoForEmbed: (el) => this.dragSource.getBlockInfoForEmbed(el),
            getIndentUnitWidthForDoc: (doc) => this.textMutation.getIndentUnitWidthForDoc(doc),
            getLineRect: (ln, fc) => this.geometry.getLineRect(ln, fc),
            getInsertionAnchorY: (ln, fc) => this.geometry.getInsertionAnchorY(ln, fc),
            getLineIndentPosByWidth: (ln, w) => this.geometry.getLineIndentPosByWidth(ln, w),
            getBlockRect: (s, e, fc) => this.geometry.getBlockRect(s, e, fc),
            ...hooks,
        };
    }

    createBlockMoverDeps(): Omit<BlockMoverDeps, 'view'> {
        const sharedDeps = this.createSharedMutationPolicyDeps();
        return {
            ...sharedDeps,
            buildInsertText: (doc, src, ln, content, lcln, lid, ltw) =>
                this.textMutation.buildInsertText(doc, src, ln, content, lcln, lid, ltw),
        };
    }

    private createSharedMutationPolicyDeps(): Pick<
        DropTargetCalculatorDeps,
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
