/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { ToggleStickyScroll } from 'vs/editor/contrib/stickyScroll/browser/stickyScrollActions';
import { StickyScrollController } from 'vs/editor/contrib/stickyScroll/browser/stickyScrollController';
import { registerAction2 } from 'vs/platform/actions/common/actions';

registerEditorContribution(StickyScrollController.ID, StickyScrollController);
registerAction2(ToggleStickyScroll);
