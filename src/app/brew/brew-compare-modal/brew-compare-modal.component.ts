import { Component, inject, Input, OnInit } from '@angular/core';

import {
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCol,
  IonContent,
  IonGrid,
  IonHeader,
  IonRow,
  ModalController,
} from '@ionic/angular/standalone';

import { Brew } from '../../../classes/brew/brew';
import { GraphDisplayCardComponent } from '../../../components/graph-display-card/graph-display-card.component';
import { HeaderComponent } from '../../../components/header/header.component';
import { HeaderDismissButtonComponent } from '../../../components/header/header-dismiss-button.component';
import { UIBrewStorage } from '../../../services/uiBrewStorage';

@Component({
  selector: 'brew-compare-modal',
  templateUrl: './brew-compare-modal.component.html',
  styleUrls: ['./brew-compare-modal.component.scss'],
  imports: [
    HeaderComponent,
    HeaderDismissButtonComponent,
    GraphDisplayCardComponent,
    IonHeader,
    IonContent,
    IonGrid,
    IonRow,
    IonCol,
    IonCard,
    IonCardHeader,
    IonCardContent,
  ],
})
export class BrewCompareModalComponent implements OnInit {
  public static readonly COMPONENT_ID = 'brew-compare-modal';
  private readonly modalController = inject(ModalController);
  private readonly uiBrewStorage = inject(UIBrewStorage);

  @Input() public brew: Brew;
  @Input() public previousBrew: Brew | null = null;

  public ngOnInit(): void {
    if (!this.previousBrew) {
      this.previousBrew = this.findPreviousBrew();
    }
  }

  public dismiss() {
    this.modalController.dismiss(
      { dismissed: true },
      undefined,
      BrewCompareModalComponent.COMPONENT_ID,
    );
  }

  public delta(current: number, previous: number): string {
    if (current === null || current === undefined) {
      return '';
    }
    if (previous === null || previous === undefined) {
      return '';
    }
    const value = current - previous;
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}`;
  }

  private findPreviousBrew(): Brew | null {
    const allBrews = this.uiBrewStorage
      .getAllEntries()
      .filter((entry) => entry.config.uuid !== this.brew.config.uuid)
      .sort((a, b) => b.config.unix_timestamp - a.config.unix_timestamp);

    const sameBean = allBrews.find((entry) => entry.bean === this.brew.bean);
    if (sameBean) {
      return sameBean;
    }

    const samePreparation = allBrews.find(
      (entry) => entry.method_of_preparation === this.brew.method_of_preparation,
    );
    if (samePreparation) {
      return samePreparation;
    }

    return allBrews[0] || null;
  }
}
