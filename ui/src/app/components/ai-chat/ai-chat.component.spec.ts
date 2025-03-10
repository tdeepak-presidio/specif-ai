import { AiChatComponent } from './ai-chat.component';
import { ComponentFixture, TestBed } from '@angular/core/testing';

describe('AiChatComponent', () => {
  let component: AiChatComponent;
  let fixture: ComponentFixture<AiChatComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [AiChatComponent],
    });
    fixture = TestBed.createComponent(AiChatComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
