import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ProjectsState } from '../../store/projects/projects.state';
import { Store } from '@ngxs/store';
import {
  CreateFile,
  ArchiveFile,
  ReadFile,
  UpdateFile,
  checkBPFileAssociations,
  BulkReadFiles,
  BulkUpdateFiles,
} from '../../store/projects/projects.actions';
import { getDescriptionFromInput } from '../../utils/common.utils';
import {
  IAddRequirementRequest,
  IUpdateRequirementRequest,
} from '../../model/interfaces/IRequirement';
import { FeatureService } from '../../services/feature/feature.service';
import { IList } from '../../model/interfaces/IList';
import {
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { AddBreadcrumb } from '../../store/breadcrumb/breadcrumb.actions';
import { NgClass, NgFor, NgIf } from '@angular/common';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { InputFieldComponent } from '../../components/core/input-field/input-field.component';
import { ButtonComponent } from '../../components/core/button/button.component';
import { AiChatComponent } from '../../components/ai-chat/ai-chat.component';
import { MultiUploadComponent } from '../../components/multi-upload/multi-upload.component';
import { provideIcons } from '@ng-icons/core';
import { ConfirmationDialogComponent } from '../../components/confirmation-dialog/confirmation-dialog.component';
import {
  CONFIRMATION_DIALOG,
  ERROR_MESSAGES,
  FOLDER,
  FOLDER_REQUIREMENT_TYPE_MAP,
  REQUIREMENT_TYPE,
  REQUIREMENT_TYPE_FOLDER_MAP,
  TOASTER_MESSAGES,
} from '../../constants/app.constants';
import { ToasterService } from 'src/app/services/toaster/toaster.service';
import { catchError, switchMap, take, Observable, filter, first } from 'rxjs';
import { RequirementTypeEnum } from 'src/app/model/enum/requirement-type.enum';
import { heroSparklesSolid } from '@ng-icons/heroicons/solid';
import { RichTextEditorComponent } from 'src/app/components/core/rich-text-editor/rich-text-editor.component';
import { truncateMarkdown } from 'src/app/utils/markdown.utils';

@Component({
  selector: 'app-edit-solution',
  templateUrl: './edit-solution.component.html',
  styleUrls: ['./edit-solution.component.scss'],
  standalone: true,
  imports: [
    NgClass,
    NgIf,
    NgFor,
    MatMenuModule,
    ReactiveFormsModule,
    InputFieldComponent,
    ButtonComponent,
    AiChatComponent,
    MultiUploadComponent,
    MatTooltipModule,
    RichTextEditorComponent,
  ],
  providers: [
    provideIcons({
      heroSparklesSolid,
    }),
  ],
})
export class EditSolutionComponent {
  projectId: string = '';
  folderName: string = '';
  fileName: string = '';
  name: string = '';
  description: string = '';
  content: string = '';
  title: string = '';
  uploadedFileContent = '';
  mode: 'edit' | 'add' = 'edit';
  message: string = '';
  data: any = {};
  generateLoader: boolean = false;
  initialData: any = {};
  selectedRequirement: any = {};
  absoluteFilePath: string = '';
  oldContent: string = '';
  public loading: boolean = false;
  selectedFileContent$ = this.store.select(
    ProjectsState.getSelectedFileContent,
  );
  requirementForm!: FormGroup;
  response: IList = {} as IList;
  chatHistory: any = [];
  allowFreeRedirection: boolean = false;
  activeTab: 'includeFiles' | 'chat' = 'includeFiles';
  documentList: IList[] = [];
  currentLinkedPRDs: Array<string> = [];
  originalDocumentList$: Observable<IList[]> = this.store.select(
    ProjectsState.getSelectedFileContents,
  );

  constructor(
    private store: Store,
    private router: Router,
    private featureService: FeatureService,
    private dialog: MatDialog,
    private toastService: ToasterService,
  ) {
    const url = this.router.url;
    this.mode = url.includes('/add') ? 'add' : 'edit';
    const navigation = this.router.getCurrentNavigation();
    this.projectId = navigation?.extras?.state?.['id'];
    this.folderName = navigation?.extras?.state?.['folderName'];
    this.initialData = navigation?.extras?.state?.['data'];
    this.selectedRequirement = navigation?.extras?.state?.['req'];
    this.store.dispatch(
      new AddBreadcrumb({
        url: `/apps/${this.projectId}`,
        label: this.folderName,
        state: {
          data: this.initialData,
          selectedFolder: {
            title: this.folderName,
            id: this.projectId,
            metadata: this.initialData,
          },
        },
      }),
    );
    this.store.dispatch(
      new AddBreadcrumb({
        label: this.mode === 'edit' ? 'Edit' : 'Add',
      }),
    );
    if (this.mode === 'edit') {
      this.fileName = navigation?.extras?.state?.['fileName'];
      this.absoluteFilePath = `${this.folderName}/${this.fileName}`;
      this.name = this.initialData?.name;
      this.description = this.initialData?.description;
    }
    this.subscribeToDocuments();
    this.createRequirementForm();
  }

  subscribeToDocuments() {
    let requirementTypeToRead: string;

    const requirementType = FOLDER_REQUIREMENT_TYPE_MAP[this.folderName];

    switch (requirementType) {
      case REQUIREMENT_TYPE.PRD: {
        requirementTypeToRead = REQUIREMENT_TYPE.BRD;
        break;
      }
      case REQUIREMENT_TYPE.BRD: {
        requirementTypeToRead = REQUIREMENT_TYPE.PRD;
        break;
      }
      default: {
        // need not subscribe to documents list for other types
        return;
      }
    }

    this.store.dispatch(new BulkReadFiles(requirementTypeToRead));
    this.originalDocumentList$.subscribe((documents) => {
      const folderName = documents[0].folderName;

      if (
        folderName ===
        (REQUIREMENT_TYPE_FOLDER_MAP as Record<string, string>)[
          requirementTypeToRead
        ]
      ) {
        this.documentList = documents;
      }
    });
  }

  async updateRequirementWithAI() {
    const formValue = this.requirementForm.getRawValue();

    const body: IUpdateRequirementRequest = {
      updatedReqt: formValue.title,
      addReqtType: this.folderName,
      fileContent: this.uploadedFileContent,
      contentType: this.uploadedFileContent ? 'fileContent' : 'userContent',
      id: this.initialData.id,
      reqId: this.fileName.replace(/\-base.json$/, ''),
      reqDesc: formValue.content,
      name: this.initialData.name,
      description: this.initialData.description,
      useGenAI: true,
    };

    try {
      if (this.isPRD()) {
        body.brds = this.getBRDDataFromIds(formValue.linkedBRDIds ?? []);
      }

      const data = await this.featureService.updateRequirement(body);

      const fileData: IList['content'] = {
            requirement: data.updated.requirement,
            title: data.updated.title,
            chatHistory: this.chatHistory,
            epicTicketId: this.initialData.epicTicketId,
          };

      if (this.isPRD()) {
        fileData.linkedBRDIds = formValue.linkedBRDIds;
      }

      this.store.dispatch(new UpdateFile(this.absoluteFilePath, fileData));

      if (this.isBRD()) {
        this.handlePRDBRDLinkUpdates(formValue);
      }
      
      this.allowFreeRedirection = true;
      this.store.dispatch(
        new ReadFile(`${this.folderName}/${this.fileName}`),
      );
      
      this.selectedFileContent$.subscribe((res: any) => {
        this.oldContent = res.requirement;
        this.requirementForm.patchValue({
          title: res.title,
          content: res.requirement,
          epicticketid: res.epicTicketId,
        });
        this.chatHistory = res.chatHistory || [];
      });
      
      this.toastService.showSuccess(
        TOASTER_MESSAGES.ENTITY.UPDATE.SUCCESS(body.addReqtType, data.reqId),
      );
    } catch (error) {
      console.error('Error updating requirement:', error);
      this.toastService.showError(
        TOASTER_MESSAGES.ENTITY.UPDATE.FAILURE(this.folderName, body.reqId),
      );
    }
  }

  updateRequirement() {
    const formValue = this.requirementForm.getRawValue();
    const fileData: IList['content'] = {
      requirement: formValue.content,
      title: formValue.title,
      chatHistory: this.chatHistory,
      epicTicketId: this.initialData.epicTicketId,
    };

    if (this.isPRD()) {
      fileData.linkedBRDIds = formValue.linkedBRDIds;
    }

    this.store.dispatch(new UpdateFile(this.absoluteFilePath, fileData));

    if (this.isBRD()) {
      this.handlePRDBRDLinkUpdates(formValue);
    }

    this.allowFreeRedirection = true;
    this.store.dispatch(new ReadFile(`${this.folderName}/${this.fileName}`));
    this.selectedFileContent$.subscribe((res: any) => {
      this.oldContent = res.requirement;
      this.requirementForm.patchValue({
        title: res.title,
        epicticketid: res.epicTicketId,
      });
      this.chatHistory = res.chatHistory || [];
    });
    this.toastService.showSuccess(
      TOASTER_MESSAGES.ENTITY.UPDATE.SUCCESS(
        this.folderName,
        this.fileName.replace(/\-base.json$/, ''),
      ),
    );
  }

  private updateBRDLinksInPRDs(
    currBRDId: string,
    updatedLinkedToPRDIds: Array<string>,
  ) {
    const toRemovedLinkedPRDIds = this.currentLinkedPRDs.filter(
      (cPRDId) =>
        !updatedLinkedToPRDIds.find((uPRDId: string) => uPRDId === cPRDId),
    );

    if (toRemovedLinkedPRDIds.length > 0) {
      const toUpdatePRDFiles: Array<{ path: string; content: object }> = [];

      this.documentList.map((prd) => {
        const prdId = prd.fileName.split('-')[0];
        const prdContent = prd.content;

        if (toRemovedLinkedPRDIds.includes(prdId)) {
          toUpdatePRDFiles.push({
            content: {
              ...prdContent,
              linkedBRDIds: prdContent.linkedBRDIds?.filter(
                (brdId) => brdId != currBRDId,
              ),
            },
            path: `${FOLDER.PRD}/${prd.fileName}`,
          });
        }
      });

      this.currentLinkedPRDs = updatedLinkedToPRDIds;
      this.requirementForm.patchValue({
        linkedToPRDIds: updatedLinkedToPRDIds,
      });

      this.store
        .dispatch(new BulkUpdateFiles(toUpdatePRDFiles))
        .subscribe(() => {
          this.store.dispatch(new BulkReadFiles(REQUIREMENT_TYPE.PRD));
        });
    }
  }

  navigateBackToDocumentList(data: any) {
    this.router.navigate(['/apps', this.projectId], {
      state: {
        data,
        selectedFolder: {
          title: this.folderName,
          id: this.projectId,
          metadata: data,
        },
      },
    });
  }

  addRequirement(useAI = false) {
    const formValue = this.requirementForm.getRawValue();
    if (formValue.expandAI || useAI || this.uploadedFileContent.length > 0) {
      const body: IAddRequirementRequest = {
        reqt: formValue.content,
        addReqtType: this.folderName,
        contentType: this.uploadedFileContent ? 'fileContent' : 'userContent',
        description: this.initialData.description,
        fileContent: this.uploadedFileContent,
        id: this.initialData.id,
        name: this.initialData.name,
        title: formValue.title,
        useGenAI: true,
      };

      if (this.isPRD()) {
        body.brds = this.getBRDDataFromIds(formValue.linkedBRDIds ?? []);
      }

      this.featureService.addRequirement(body).then(
        (data) => {
          const fileData: any = {
            requirement: data.LLMreqt.requirement,
            title: data.LLMreqt.title,
            chatHistory: this.chatHistory,
          };

          if (this.isPRD()) {
            fileData.linkedBRDIds = formValue.linkedBRDIds;
          }

          this.store.dispatch(new CreateFile(`${this.folderName}`, fileData));
          this.allowFreeRedirection = true;
          this.navigateBackToDocumentList(this.initialData);
          this.toastService.showSuccess(
            TOASTER_MESSAGES.ENTITY.ADD.SUCCESS(this.folderName),
          );
        },
        (error) => {
          console.error('Error updating requirement:', error); // Handle any errors
          this.toastService.showError(
            TOASTER_MESSAGES.ENTITY.ADD.FAILURE(this.folderName),
          );
        },
      );
    } else {
      const fileData: any = {
        requirement: formValue.content,
        title: formValue.title,
        chatHistory: this.chatHistory,
      };

      if (this.isPRD()) {
        fileData.linkedBRDIds = formValue.linkedBRDIds;
      }

      this.store.dispatch(new CreateFile(`${this.folderName}`, fileData));
      this.allowFreeRedirection = true;
      this.navigateBackToDocumentList(this.initialData);
      this.toastService.showSuccess(
        TOASTER_MESSAGES.ENTITY.ADD.SUCCESS(this.folderName),
      );
    }
  }

  private getBRDDataFromIds(brdIds: Array<string>) {
    return brdIds
      .map((brdId) => {
        const brd = this.documentList.find(
          (item) => item.fileName.split('-')[0] === brdId,
        );
        if (!brd) {
          return null;
        }
        const content = brd.content;

        if (!content.title || !content.requirement) {
          return null;
        }

        return {
          title: content.title,
          requirement: content.requirement,
        };
      })
      .filter(<T>(x: T): x is NonNullable<T> => x != null);
  }

  appendRequirement(data: any) {
    let { chat, chatHistory } = data;
    if (chat.assistant) {
      this.requirementForm.patchValue({
        content: `${this.requirementForm.get('content')?.value}
${chat.assistant}`,
      });
      let newArray = chatHistory.map((item: any) => {
        if (item.assistant == chat.assistant) return { ...item, isAdded: true };
        else return item;
      });
      this.chatHistory = newArray;
      this.updateRequirementWithAI();
    }
  }

  enhanceRequirementWithAI() {
    switch (this.mode) {
      case 'edit': {
        this.updateRequirementWithAI();
        break;
      }
      case 'add': {
        this.addRequirement(true);
        break;
      }
    }
  }

  updateChatHistory(chatHistory: any) {
    // Persist updated chatHistory with isLiked attribute
    this.store.dispatch(
      new UpdateFile(this.absoluteFilePath, {
        requirement: this.requirementForm.get('content')?.value,
        title: this.requirementForm.get('title')?.value,
        chatHistory: chatHistory.map((item: any) =>
          item.assistant && item.isLiked !== undefined
            ? { ...item, isLiked: item.isLiked }
            : item,
        ),
      }),
    );
  }

  createRequirementForm() {
    let formFields: Record<string, FormControl> = {
      title: new FormControl('', Validators.compose([Validators.required])),
      content: new FormControl('', Validators.compose([Validators.required])),
      expandAI: new FormControl(false),
    };

    if (this.isPRD()) {
      formFields = {
        ...formFields,
        linkedBRDIds: new FormControl<string[]>([]),
      };
    }

    if (this.isBRD()) {
      formFields = {
        ...formFields,
        linkedToPRDIds: new FormControl<string[]>([]),
      };
    }

    this.requirementForm = new FormGroup(formFields);

    if (this.mode === 'edit') {
      this.store.dispatch(new ReadFile(`${this.folderName}/${this.fileName}`));
      this.selectedFileContent$.subscribe((res: any) => {
        this.oldContent = res.requirement;
        this.requirementForm.patchValue({
          title: res.title,
          content: res.requirement,
          epicticketid: res.epicTicketId,
        });

        // For PRDs pre populate the linked brd ids
        if (this.isPRD()) {
          this.requirementForm.patchValue({
            linkedBRDIds: res.linkedBRDIds ?? [],
          });
        }
        this.chatHistory = res.chatHistory || [];
      });

      // For BRDs, linked prd ids will be populated by subscribeToDocuments
      if (this.isBRD()) {
        const currentBRDId = this.fileName.split('-')[0];

        this.originalDocumentList$
          .pipe(filter((dl) => dl[0].folderName === FOLDER.PRD))
          .subscribe((prdDocs) => {
            const linkedToPRDIds: Array<string> = [];

            prdDocs.forEach((prdDoc) => {
              if (prdDoc.content.linkedBRDIds?.includes(currentBRDId)) {
                const prdId = prdDoc.fileName.split('-')[0];
                linkedToPRDIds.push(prdId);
              }
            });

            this.currentLinkedPRDs = linkedToPRDIds;
            this.requirementForm.patchValue({
              linkedToPRDIds: linkedToPRDIds,
            });
          });
      }
    }
  }

  deleteFile() {
    const reqId = this.fileName.replace(/\-base.json$/, '');

    if(this.isBRD()){
      if(this.currentLinkedPRDs.length > 0){
        this.toastService.showWarning(
          ERROR_MESSAGES.DELETE_ASSOCIATED_PRDs_ERROR(reqId, this.currentLinkedPRDs),
        );
        return;
      }
    }

    if (
      this.folderName === RequirementTypeEnum.PRD ||
      this.folderName === RequirementTypeEnum.BRD
    ) {
      this.store
        .dispatch(new checkBPFileAssociations(this.folderName, this.fileName))
        .pipe(
          switchMap(() =>
            this.store
              .select(ProjectsState.getBpAssociationStatus)
              .pipe(take(1)),
          ),
          catchError(() => {
            this.toastService.showError(
              TOASTER_MESSAGES.ENTITY.DELETE.FAILURE(this.folderName, reqId),
            );
            return [];
          }),
        )
        .subscribe((res) => {
          if (res.isAssociated) {
            this.toastService.showWarning(
              ERROR_MESSAGES.DELETE_ASSOCIATED_ERROR(reqId, res.bpIds),
            );
            return;
          }

          this.promptFileDeletion(reqId);
        });
    } else {
      this.promptFileDeletion(reqId);
    }
  }

  private handlePRDBRDLinkUpdates(formValue: any) {
    const currentBRDId = this.fileName.split('-')[0];
    this.updateBRDLinksInPRDs(currentBRDId, formValue.linkedToPRDIds);
  }

  private promptFileDeletion(reqId: string) {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '500px',
      data: {
        title: CONFIRMATION_DIALOG.DELETION.TITLE,
        description: CONFIRMATION_DIALOG.DELETION.DESCRIPTION(reqId),
        cancelButtonText: CONFIRMATION_DIALOG.DELETION.CANCEL_BUTTON_TEXT,
        proceedButtonText: CONFIRMATION_DIALOG.DELETION.PROCEED_BUTTON_TEXT,
      },
    });

    dialogRef.afterClosed().subscribe((res) => {
      if (res === false) {
        this.store.dispatch(new ArchiveFile(this.absoluteFilePath));
        this.allowFreeRedirection = true;
        this.navigateBackToDocumentList(this.initialData);
        this.toastService.showSuccess(
          TOASTER_MESSAGES.ENTITY.DELETE.SUCCESS(this.folderName, reqId),
        );
      }
    });
  }

  handleFileContent(content: string) {
    this.uploadedFileContent = content;
  }

  getDescription(input: string | undefined): string | null {
    return getDescriptionFromInput(input);
  }

  canDeactivate(): boolean {
    return (
      !this.allowFreeRedirection &&
      this.requirementForm.dirty &&
      this.requirementForm.touched
    );
  }

  removeLinkedBRDForPRD(brdId: string) {
    const currentBrdIds = this.requirementForm.get('linkedBRDIds')?.value || [];
    const updatedBrdIds = currentBrdIds.filter((id: string) => id !== brdId);
    this.requirementForm.patchValue({ linkedBRDIds: updatedBrdIds });
  }

  removeLinkedPRDFromBRD(toRemovePRDId: string) {
    const currentPRDs = this.requirementForm.get('linkedToPRDIds')?.value || [];
    const updatedPRDs = currentPRDs.filter(
      (prdId: string) => prdId !== toRemovePRDId,
    );
    this.requirementForm.patchValue({ linkedToPRDIds: updatedPRDs });
  }

  handleLinkedBRDSelectionForPRD(event: any) {
    const brdId = event.target.value;
    const isChecked = event.target.checked;
    const currentBrdIds = this.requirementForm.get('linkedBRDIds')?.value || [];

    if (isChecked && !currentBrdIds.includes(brdId)) {
      this.requirementForm.patchValue({
        linkedBRDIds: [...currentBrdIds, brdId].sort(),
      });
    } else if (!isChecked && currentBrdIds.includes(brdId)) {
      this.requirementForm.patchValue({
        linkedBRDIds: currentBrdIds.filter((id: string) => id !== brdId),
      });
    }
  }

  truncateRequirementContent(content: string): string {
    return truncateMarkdown(content, { maxChars: 120 });
  }

  isPRD = () => {
    return this.folderName === FOLDER.PRD;
  };

  isBRD = () => {
    return this.folderName === FOLDER.BRD;
  };
}
