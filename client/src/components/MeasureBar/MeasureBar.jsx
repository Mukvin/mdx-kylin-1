/*
  Licensed to the Apache Software Foundation (ASF) under one
  or more contributor license agreements.  See the NOTICE file
  distributed with this work for additional information
  regarding copyright ownership.  The ASF licenses this file
  to you under the Apache License, Version 2.0 (the
  "License"); you may not use this file except in compliance
  with the License.  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/
import React, { PureComponent, Fragment } from 'react';
import PropTypes from 'prop-types';
import { injectIntl } from 'react-intl';
import { Card, Tree, Input, Select, Tooltip, OverflowTooltip } from 'kyligence-ui-react';
import classnames from 'classnames';

import './index.less';
import { Connect } from '../../store';
import { strings, configs } from '../../constants';
import { dataHelper, domHelper, datasetHelper } from '../../utils';
import { getNodeIcon, getFilteredNodeTypes, checkValidNodeType, findDefaultMeasureGroup, checkIsCreatedNode, checkIsEditedNode, hasNonEmptyBehaviorError } from './handler';

const { translatableNodeTypes } = configs;

@Connect({
  mapState: {
    dataset: state => state.workspace.dataset,
  },
  options: {
    forwardRef: true,
  },
})
class MeasureBar extends PureComponent {
  static propTypes = {
    intl: PropTypes.object.isRequired,
    dataset: PropTypes.object.isRequired,
    onClick: PropTypes.func,
    onEdit: PropTypes.func,
    onCreate: PropTypes.func,
    shouldNodeRender: PropTypes.func,
    hideArrowWhenNoLeaves: PropTypes.bool,
    editableNodeTypes: PropTypes.array,
    isOnlyTree: PropTypes.bool,
    isLazy: PropTypes.bool,
    currentNode: PropTypes.object,
    renderEmpty: PropTypes.oneOfType([PropTypes.func, PropTypes.string, PropTypes.node]),
  };

  static defaultProps = {
    editableNodeTypes: [],
    shouldNodeRender: () => true,
    hideArrowWhenNoLeaves: false,
    isOnlyTree: false,
    currentNode: null,
    isLazy: false,
    renderEmpty: undefined,
    onClick: () => {},
    onEdit: () => {},
    onCreate: () => {},
  };

  $tree = React.createRef();
  $treeWrapper = React.createRef();
  scrollTop = 0;

  state = {
    isShowTree: true,
    expandedNodeKeysMap: {},
    currentNode: null,
    filter: {
      nodeType: 'measure',
      filteredNodeTypes: getFilteredNodeTypes({ nodeType: 'measure' }),
      name: '',
    },
  };

  constructor(props) {
    super(props);
    this.state.currentNode = props.currentNode;
    this.renderNode = this.renderNode.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
    this.handleClickNode = this.handleClickNode.bind(this);
    this.handleFilterType = this.handleFilterType.bind(this);
    this.handleFilterName = this.handleFilterName.bind(this);
    this.handleFilterNode = this.handleFilterNode.bind(this);
  }

  componentDidMount() {
    this.refreshTree(() => {
      this.heightlightCurrentNode();
    });
  }

  /* eslint-disable camelcase */
  async UNSAFE_componentWillReceiveProps(nextProps) {
    const { dataset: oldDataset, currentNode: oldCurrentNode } = this.props;
    const { dataset: newDataset, currentNode: newCurrentNode } = nextProps;
    const isCreatedNode = checkIsCreatedNode(oldCurrentNode, newCurrentNode);
    const isEditedNode = checkIsEditedNode(oldCurrentNode, newCurrentNode);
    const isValidNodeType = checkValidNodeType(newCurrentNode);

    if (isValidNodeType) {
      // 如果是合法节点，处理从父级展开到叶子节点
      await this.setState({ currentNode: newCurrentNode });
      this.setExpandNodes();
    } else {
      // 如果是不合法节点，节点清空高亮
      await this.setState({ currentNode: null });
      this.$tree.current.clearCurrentNodeKey();
    }
    // 处理树刷新逻辑
    if (isCreatedNode || isEditedNode || oldDataset !== newDataset) {
      await this.refreshTree(isValidNodeType);
      this.heightlightCurrentNode();
    }
  }

  componentWillUnmount() {
    this.removeEventListener();
  }

  get expandedKeys() {
    const { expandedNodeKeysMap } = this.state;
    return Object
      .values(expandedNodeKeysMap)
      .reduce((allExpandedKeys, expandedKeys) => (
        [...allExpandedKeys, ...expandedKeys]
      ), []);
  }

  get filterOptions() {
    const { intl } = this.props;
    return [
      {
        label: intl.formatMessage(strings.MEASURE),
        value: 'measure',
        icon: getNodeIcon({ nodeType: 'measure' }),
      },
      {
        label: intl.formatMessage(strings.CALCULATED_MEASURE),
        value: 'calculateMeasure',
        icon: getNodeIcon({ nodeType: 'calculateMeasure' }),
      },
    ];
  }

  get measureTree() {
    const { dataset } = this.props;
    return datasetHelper.getMeasureTree({ dataset });
  }

  setExpandMeasure(item) {
    const expandMeasureGroup = { nodeType: 'measureGroup', key: item.model };
    return this.handleNodesExpand([expandMeasureGroup]);
  }

  setExpandMeasureGroup(item) {
    const isInRootFolder = item.folder === 'Calculated Measure';
    // 用于度量树展示全局计算度量
    if (isInRootFolder) {
      const expandMeasureGroup = { nodeType: 'calculateMeasureRoot', key: 'calculateMeasureRoot' };
      return this.handleNodesExpand([expandMeasureGroup]);
    }
    // 用于度量树展示模型级计算度量
    if (!isInRootFolder) {
      const expandMeasureGroup = { nodeType: 'measureGroup', key: item.folder };
      return this.handleNodesExpand([expandMeasureGroup]);
    }
    return false;
  }

  setExpandNodes() {
    const { currentNode } = this.state;
    const isEditingNode = currentNode && !!currentNode.name;

    if (isEditingNode) {
      switch (currentNode.nodeType) {
        // 计算度量：在度量列表展开到度量组
        case 'measure': return this.setExpandMeasure(currentNode);
        case 'calculateMeasure': return this.setExpandMeasureGroup(currentNode);
        default: return false;
      }
    }
    return false;
  }

  heightlightCurrentNode() {
    const $treeRef = this.$tree.current;
    // 获取需要高亮的节点
    const { currentNode: heightlightNode } = this.state;
    // 树组件未挂载/没有高亮节点 防止调用函数报错
    if ($treeRef && heightlightNode) {
      const { props = {} } = $treeRef.getCurrentNode() || {};
      const { nodeModel = {} } = props;
      const { data = {} } = nodeModel;

      // 如果 树高亮节点 与 需要被高亮节点 相同，则不调用高亮函数，防止当前节点被折叠
      if (data.key !== heightlightNode.key) {
        $treeRef.setCurrentNodeKey(heightlightNode.key);
      }
    }
  }

  scrollToNode() {
    const { currentNode } = this.state;
    const { $tree, $treeWrapper } = this;
    if (currentNode && $treeWrapper.current) {
      if ($tree.current) {
        // 组件库bug：root.expanded默认为关，然后就不动了，这边手动打开一下
        $tree.current.state.store.root.expanded = true;
        const position = $tree.current.getNodePosition(currentNode.key);
        domHelper.scrollTo($treeWrapper.current, position);
      }
    }
  }

  scrollToLastPosition() {
    const { $treeWrapper, scrollTop } = this;
    if ($treeWrapper.current) {
      domHelper.scrollTo($treeWrapper.current, scrollTop);
    }
  }

  addEventListener() {
    const $treeWrapperRef = this.$treeWrapper.current;
    if ($treeWrapperRef) {
      $treeWrapperRef.addEventListener('scroll', this.handleScroll);
    }
  }

  removeEventListener() {
    const $treeWrapperRef = this.$treeWrapper.current;
    if ($treeWrapperRef) {
      $treeWrapperRef.removeEventListener('scroll', this.handleScroll);
    }
  }

  refreshTree(isValidNodeType) {
    return new Promise(resolve => {
      // 销毁树，并且移除事件监听
      this.removeEventListener();
      this.setState({ isShowTree: false }, () => {
        // 展现树，并且添加事件监听
        this.setState({ isShowTree: true }, () => {
          this.addEventListener();
          setTimeout(() => {
            // 滚动到高亮节点
            if (isValidNodeType) {
              this.scrollToNode();
            } else {
              // 否则滚动到上一次的位置
              this.scrollToLastPosition();
            }
            resolve();
          }, 300);
        });
      });
    });
  }

  async selectDefaultMeasureGroup(selectNodeTypes) {
    const { measureTree } = this;
    const defaultMeasureGroup = findDefaultMeasureGroup(measureTree, selectNodeTypes);

    if (defaultMeasureGroup) {
      await this.refreshTree();
      this.$tree.current.setCurrentNodeKey(defaultMeasureGroup.key);
    }
  }

  handleScroll() {
    const $treeWrapperRef = this.$treeWrapper.current;
    if ($treeWrapperRef) {
      this.scrollTop = $treeWrapperRef.scrollTop;
    }
  }

  handleClickNew(type) {
    const { onCreate } = this.props;
    if (onCreate) {
      onCreate(type);
    }
  }

  handleClickNode(data, isEdit, event) {
    const { onClick, onEdit } = this.props;
    const onClickFunc = isEdit ? onEdit : onClick;

    if (isEdit && event) {
      event.stopPropagation();
    }

    if (onClickFunc) {
      onClickFunc(data);
    }
  }

  handleNodesExpand(nodesData = []) {
    let isNodesNotExpanded = false;
    let { expandedNodeKeysMap } = this.state;

    for (const nodeData of nodesData) {
      const { nodeType, key } = nodeData;

      if (!expandedNodeKeysMap[nodeType]) {
        expandedNodeKeysMap[nodeType] = [];
      }

      const expendedNodeKeys = expandedNodeKeysMap[nodeType];
      const isNotExpanded = !expendedNodeKeys.includes(key);

      if (isNotExpanded) {
        expandedNodeKeysMap = {
          ...expandedNodeKeysMap,
          [nodeType]: [...expendedNodeKeys, key],
        };
      }

      isNodesNotExpanded = isNodesNotExpanded || isNotExpanded;
    }

    this.setState({ expandedNodeKeysMap });

    return isNodesNotExpanded;
  }

  handleNodesCollapse(nodesData = []) {
    let isNodesExpanded = false;
    let { expandedNodeKeysMap } = this.state;

    for (const nodeData of nodesData) {
      const { nodeType, key } = nodeData;

      if (!expandedNodeKeysMap[nodeType]) {
        expandedNodeKeysMap[nodeType] = [];
      }

      const expendedNodeKeys = expandedNodeKeysMap[nodeType];
      const isExpanded = expendedNodeKeys.includes(key);

      if (isExpanded) {
        expandedNodeKeysMap = {
          ...expandedNodeKeysMap,
          [nodeType]: expendedNodeKeys.filter(nodeKey => nodeKey !== key),
        };
      }

      isNodesExpanded = isNodesExpanded || isExpanded;
    }

    this.setState({ expandedNodeKeysMap });

    return isNodesExpanded;
  }

  handleFilterName(name) {
    const { filter: oldFilter } = this.state;
    const filter = { ...oldFilter, name };
    this.setState({ filter }, () => {
      this.$tree.current.filter(filter);
    });
  }

  handleFilterType(nodeType) {
    const { filter: oldFilter } = this.state;
    const filteredNodeTypes = getFilteredNodeTypes({ nodeType });
    const filter = { ...oldFilter, nodeType, filteredNodeTypes };
    this.setState({ filter }, () => {
      if (filter.name) {
        this.$tree.current.filter(filter);
      }
    });
  }

  handleFilterNode(filter, data) {
    const { intl } = this.props;
    const { filteredNodeTypes = [], name: input, nodeType } = filter;
    const isFilteredNode = filteredNodeTypes
      .filter(n => n !== nodeType)
      .includes(data.nodeType);

    if (!input) {
      return true;
    }

    if (data.alias) {
      const translateAlias = dataHelper.translate(intl, data.alias);
      const isFilteredAlias = translateAlias.toLowerCase().includes(input.toLowerCase());
      return isFilteredNode || (nodeType === data.nodeType && isFilteredAlias);
    }

    const translateName = dataHelper.translate(intl, data.name || data.label);
    const isFilteredName = translateName.toLowerCase().includes(input.toLowerCase());
    return isFilteredNode || (nodeType === data.nodeType && isFilteredName);
  }

  renderCardHeader() {
    const { intl } = this.props;
    return (
      <div className="clearfix">
        <div className="card-title">{intl.formatMessage(strings.MEASURE)}</div>
        <div className="card-actions">
          <Tooltip
            appendToBody
            className="card-action"
            placement="top"
            content={intl.formatMessage(strings.ADD_CALCULATED_MEASURE)}
          >
            <i className="mdx-it-add-cMeasure icon-superset-add_calculated_measure" onClick={() => this.handleClickNew('calculateMeasure')} />
          </Tooltip>
        </div>
      </div>
    );
  }

  renderNode(node, data) {
    const { editableNodeTypes, intl } = this.props;
    const isShowEdit = editableNodeTypes.includes(data.nodeType);
    const label = translatableNodeTypes.includes(data.nodeType)
      ? dataHelper.translate(intl, data.label)
      : data.label;

    let hasError = false;
    switch (data.nodeType) {
      case 'measureGroup': {
        hasError = data.children.some(item => item.error ||
          hasNonEmptyBehaviorError(item));
        break;
      }
      case 'calculateMeasureRoot': {
        hasError = data.children.some(item => item.error ||
          hasNonEmptyBehaviorError(item));
        break;
      }
      case 'calculateMeasure': {
        hasError = !!data.error ||
          hasNonEmptyBehaviorError(data);
        break;
      }
      case 'measure':
      default: break;
    }

    return (
      <Fragment>
        <span className="node-content" id={data.key}>
          <OverflowTooltip content={label}>
            <span>
              {hasError && <i className="error-icon icon-superset-alert" />}
              <i className={classnames(['perfix-icon', getNodeIcon(data)])} />
              <span style={{ whiteSpace: 'pre' }} title={label}>{label}</span>
            </span>
          </OverflowTooltip>
        </span>
        {isShowEdit && (
          <i
            className="action-item icon-superset-table_edit"
            onClick={event => this.handleClickNode(data, true, event)}
          />
        )}
      </Fragment>
    );
  }

  /* eslint-disable max-len */
  render() {
    const { intl, isOnlyTree, shouldNodeRender, hideArrowWhenNoLeaves, isLazy, renderEmpty } = this.props;
    const { isShowTree, filter } = this.state;
    const { $tree, $treeWrapper, filterOptions, measureTree } = this;
    const filterIcon = getNodeIcon({ nodeType: filter.nodeType });

    return !isOnlyTree ? (
      <Card className="measure-bar" header={this.renderCardHeader()} bodyStyle={{ padding: null }}>
        <div className="actions clearfix">
          <Select
            className="icon-mode filter-type mdx-it-measure-bar-type-filter"
            prefixIcon={filterIcon}
            value={filter.nodeType}
            onChange={this.handleFilterType}
          >
            {filterOptions.map(option => (
              <Select.Option key={option.value} value={option.value}>
                <Tooltip
                  positionFixed
                  className="option-item"
                  popperClass="option-item-tooltip"
                  placement="top"
                  content={option.label}
                >
                  <i className={option.icon} />
                </Tooltip>
              </Select.Option>
            ))}
          </Select>
          <Input
            className="filter-name mdx-it-measure-bar-name-filter"
            prefixIcon="icon-superset-search"
            value={filter.name}
            onChange={this.handleFilterName}
            placeholder={intl.formatMessage(strings.FILTER)}
          />
        </div>
        {isShowTree && (
          <div className="measure-tree" ref={$treeWrapper}>
            <Tree
              isLazy={isLazy}
              highlightCurrent
              ref={$tree}
              nodeKey="key"
              autoExpandParent={false}
              data={measureTree}
              defaultExpandedKeys={this.expandedKeys}
              renderContent={this.renderNode}
              emptyText={intl.formatMessage(strings.NO_DATA)}
              renderEmpty={renderEmpty}
              hideArrowWhenNoLeaves={hideArrowWhenNoLeaves}
              filterNodeMethod={this.handleFilterNode}
              shouldNodeRender={shouldNodeRender}
              onNodeClicked={data => this.handleClickNode(data, false)}
              onNodeExpand={data => this.handleNodesExpand([data])}
              onNodeCollapse={data => this.handleNodesCollapse([data])}
            />
          </div>
        )}
      </Card>
    ) : isShowTree && (
      <div className="measure-bar is-only-tree" ref={$treeWrapper}>
        <Tree
          isLazy={isLazy}
          highlightCurrent
          ref={$tree}
          nodeKey="key"
          autoExpandParent={false}
          data={measureTree}
          defaultExpandedKeys={this.expandedKeys}
          renderContent={this.renderNode}
          emptyText={intl.formatMessage(strings.NO_DATA)}
          renderEmpty={renderEmpty}
          hideArrowWhenNoLeaves={hideArrowWhenNoLeaves}
          filterNodeMethod={this.handleFilterNode}
          shouldNodeRender={shouldNodeRender}
          onNodeClicked={data => this.handleClickNode(data, false)}
          onNodeExpand={data => this.handleNodesExpand([data])}
          onNodeCollapse={data => this.handleNodesCollapse([data])}
        />
      </div>
    );
  }
  /* eslint-enable */
}

export default injectIntl(MeasureBar, { forwardRef: true });
