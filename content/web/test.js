var PDFPageView =
    /*#__PURE__*/
    function() {
        function PDFPageView(options) {
            _classCallCheck(this, PDFPageView);

            var container = options.container;
            var defaultViewport = options.defaultViewport;
            this.id = options.id;
            this.renderingId = 'page' + this.id;
            this.pdfPage = null;
            this.pageLabel = null;
            this.rotation = 0;
            this.scale = options.scale || _ui_utils.DEFAULT_SCALE;
            this.viewport = defaultViewport;
            this.pdfPageRotate = defaultViewport.rotation;
            this.hasRestrictedScaling = false;
            this.textLayerMode = Number.isInteger(options.textLayerMode) ? options.textLayerMode : _ui_utils.TextLayerMode.ENABLE;
            this.imageResourcesPath = options.imageResourcesPath || '';
            this.renderInteractiveForms = options.renderInteractiveForms || false;
            this.useOnlyCssZoom = options.useOnlyCssZoom || false;
            this.maxCanvasPixels = options.maxCanvasPixels || MAX_CANVAS_PIXELS;
            this.eventBus = options.eventBus || (0, _ui_utils.getGlobalEventBus)();
            this.renderingQueue = options.renderingQueue;
            this.textLayerFactory = options.textLayerFactory;
            this.annotationLayerFactory = options.annotationLayerFactory;
            this.renderer = options.renderer || _ui_utils.RendererType.CANVAS;
            this.enableWebGL = options.enableWebGL || false;
            this.l10n = options.l10n || _ui_utils.NullL10n;
            this.paintTask = null;
            this.paintedViewportMap = new WeakMap();
            this.renderingState = _pdf_rendering_queue.RenderingStates.INITIAL;
            this.resume = null;
            this.error = null;
            this.annotationLayer = null;
            this.textLayer = null;
            this.zoomLayer = null;
            var div = document.createElement('div');
            div.className = 'page';
            div.style.width = Math.floor(this.viewport.width) + 'px';
            div.style.height = Math.floor(this.viewport.height) + 'px';
            div.setAttribute('data-page-number', this.id);
            this.div = div;
            container.appendChild(div);
        }

        _createClass(PDFPageView, [{
            key: "setPdfPage",
            value: function setPdfPage(pdfPage) {
                this.pdfPage = pdfPage;
                this.pdfPageRotate = pdfPage.rotate;
                var totalRotation = (this.rotation + this.pdfPageRotate) % 360;
                this.viewport = pdfPage.getViewport({
                    scale: this.scale * _ui_utils.CSS_UNITS,
                    rotation: totalRotation
                });
                this.stats = pdfPage.stats;
                this.reset();
            }
        }, {
            key: "destroy",
            value: function destroy() {
                this.reset();

                if (this.pdfPage) {
                    this.pdfPage.cleanup();
                }
            }
        }, {
            key: "_resetZoomLayer",
            value: function _resetZoomLayer() {
                var removeFromDOM = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

                if (!this.zoomLayer) {
                    return;
                }

                var zoomLayerCanvas = this.zoomLayer.firstChild;
                this.paintedViewportMap["delete"](zoomLayerCanvas);
                zoomLayerCanvas.width = 0;
                zoomLayerCanvas.height = 0;

                if (removeFromDOM) {
                    this.zoomLayer.remove();
                }

                this.zoomLayer = null;
            }
        }, {
            key: "reset",
            value: function reset() {
                var keepZoomLayer = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;
                var keepAnnotations = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
                this.cancelRendering(keepAnnotations);
                this.renderingState = _pdf_rendering_queue.RenderingStates.INITIAL;
                var div = this.div;
                div.style.width = Math.floor(this.viewport.width) + 'px';
                div.style.height = Math.floor(this.viewport.height) + 'px';
                var childNodes = div.childNodes;
                var currentZoomLayerNode = keepZoomLayer && this.zoomLayer || null;
                var currentAnnotationNode = keepAnnotations && this.annotationLayer && this.annotationLayer.div || null;

                for (var i = childNodes.length - 1; i >= 0; i--) {
                    var node = childNodes[i];

                    if (currentZoomLayerNode === node || currentAnnotationNode === node) {
                        continue;
                    }

                    div.removeChild(node);
                }

                div.removeAttribute('data-loaded');

                if (currentAnnotationNode) {
                    this.annotationLayer.hide();
                } else if (this.annotationLayer) {
                    this.annotationLayer.cancel();
                    this.annotationLayer = null;
                }

                if (!currentZoomLayerNode) {
                    if (this.canvas) {
                        this.paintedViewportMap["delete"](this.canvas);
                        this.canvas.width = 0;
                        this.canvas.height = 0;
                        delete this.canvas;
                    }

                    this._resetZoomLayer();
                }

                if (this.svg) {
                    this.paintedViewportMap["delete"](this.svg);
                    delete this.svg;
                }

                this.loadingIconDiv = document.createElement('div');
                this.loadingIconDiv.className = 'loadingIcon';
                div.appendChild(this.loadingIconDiv);
            }
        }, {
            key: "update",
            value: function update(scale, rotation) {
                this.scale = scale || this.scale;

                if (typeof rotation !== 'undefined') {
                    this.rotation = rotation;
                }

                var totalRotation = (this.rotation + this.pdfPageRotate) % 360;
                this.viewport = this.viewport.clone({
                    scale: this.scale * _ui_utils.CSS_UNITS,
                    rotation: totalRotation
                });

                if (this.svg) {
                    this.cssTransform(this.svg, true);
                    this.eventBus.dispatch('pagerendered', {
                        source: this,
                        pageNumber: this.id,
                        cssTransform: true,
                        timestamp: performance.now()
                    });
                    return;
                }

                var isScalingRestricted = false;

                if (this.canvas && this.maxCanvasPixels > 0) {
                    var outputScale = this.outputScale;

                    if ((Math.floor(this.viewport.width) * outputScale.sx | 0) * (Math.floor(this.viewport.height) * outputScale.sy | 0) > this.maxCanvasPixels) {
                        isScalingRestricted = true;
                    }
                }

                if (this.canvas) {
                    if (this.useOnlyCssZoom || this.hasRestrictedScaling && isScalingRestricted) {
                        this.cssTransform(this.canvas, true);
                        this.eventBus.dispatch('pagerendered', {
                            source: this,
                            pageNumber: this.id,
                            cssTransform: true,
                            timestamp: performance.now()
                        });
                        return;
                    }

                    if (!this.zoomLayer && !this.canvas.hasAttribute('hidden')) {
                        this.zoomLayer = this.canvas.parentNode;
                        this.zoomLayer.style.position = 'absolute';
                    }
                }

                if (this.zoomLayer) {
                    this.cssTransform(this.zoomLayer.firstChild);
                }

                this.reset(true, true);
            }
        }, {
            key: "cancelRendering",
            value: function cancelRendering() {
                var keepAnnotations = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : false;

                if (this.paintTask) {
                    this.paintTask.cancel();
                    this.paintTask = null;
                }

                this.resume = null;

                if (this.textLayer) {
                    this.textLayer.cancel();
                    this.textLayer = null;
                }

                if (!keepAnnotations && this.annotationLayer) {
                    this.annotationLayer.cancel();
                    this.annotationLayer = null;
                }
            }
        }, {
            key: "cssTransform",
            value: function cssTransform(target) {
                var redrawAnnotations = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
                var width = this.viewport.width;
                var height = this.viewport.height;
                var div = this.div;
                target.style.width = target.parentNode.style.width = div.style.width = Math.floor(width) + 'px';
                target.style.height = target.parentNode.style.height = div.style.height = Math.floor(height) + 'px';
                var relativeRotation = this.viewport.rotation - this.paintedViewportMap.get(target).rotation;
                var absRotation = Math.abs(relativeRotation);
                var scaleX = 1,
                    scaleY = 1;

                if (absRotation === 90 || absRotation === 270) {
                    scaleX = height / width;
                    scaleY = width / height;
                }

                var cssTransform = 'rotate(' + relativeRotation + 'deg) ' + 'scale(' + scaleX + ',' + scaleY + ')';
                target.style.transform = cssTransform;

                if (this.textLayer) {
                    var textLayerViewport = this.textLayer.viewport;
                    var textRelativeRotation = this.viewport.rotation - textLayerViewport.rotation;
                    var textAbsRotation = Math.abs(textRelativeRotation);
                    var scale = width / textLayerViewport.width;

                    if (textAbsRotation === 90 || textAbsRotation === 270) {
                        scale = width / textLayerViewport.height;
                    }

                    var textLayerDiv = this.textLayer.textLayerDiv;
                    var transX, transY;

                    switch (textAbsRotation) {
                        case 0:
                            transX = transY = 0;
                            break;

                        case 90:
                            transX = 0;
                            transY = '-' + textLayerDiv.style.height;
                            break;

                        case 180:
                            transX = '-' + textLayerDiv.style.width;
                            transY = '-' + textLayerDiv.style.height;
                            break;

                        case 270:
                            transX = '-' + textLayerDiv.style.width;
                            transY = 0;
                            break;

                        default:
                            console.error('Bad rotation value.');
                            break;
                    }

                    textLayerDiv.style.transform = 'rotate(' + textAbsRotation + 'deg) ' + 'scale(' + scale + ', ' + scale + ') ' + 'translate(' + transX + ', ' + transY + ')';
                    textLayerDiv.style.transformOrigin = '0% 0%';
                }

                if (redrawAnnotations && this.annotationLayer) {
                    this.annotationLayer.render(this.viewport, 'display');
                }
            }
        }, {
            key: "getPagePoint",
            value: function getPagePoint(x, y) {
                return this.viewport.convertToPdfPoint(x, y);
            }
        }, {
            key: "draw",
            value: function draw() {
                var _this = this;

                if (this.renderingState !== _pdf_rendering_queue.RenderingStates.INITIAL) {
                    console.error('Must be in new state before drawing');
                    this.reset();
                }

                if (!this.pdfPage) {
                    this.renderingState = _pdf_rendering_queue.RenderingStates.FINISHED;
                    return Promise.reject(new Error('Page is not loaded'));
                }

                this.renderingState = _pdf_rendering_queue.RenderingStates.RUNNING;
                var pdfPage = this.pdfPage;
                var div = this.div;
                var canvasWrapper = document.createElement('div');
                canvasWrapper.style.width = div.style.width;
                canvasWrapper.style.height = div.style.height;
                canvasWrapper.classList.add('canvasWrapper');

                if (this.annotationLayer && this.annotationLayer.div) {
                    div.insertBefore(canvasWrapper, this.annotationLayer.div);
                } else {
                    div.appendChild(canvasWrapper);
                }

                var textLayer = null;

                if (this.textLayerMode !== _ui_utils.TextLayerMode.DISABLE && this.textLayerFactory) {
                    var textLayerDiv = document.createElement('div');
                    textLayerDiv.className = 'textLayer';
                    textLayerDiv.style.width = canvasWrapper.style.width;
                    textLayerDiv.style.height = canvasWrapper.style.height;

                    if (this.annotationLayer && this.annotationLayer.div) {
                        div.insertBefore(textLayerDiv, this.annotationLayer.div);
                    } else {
                        div.appendChild(textLayerDiv);
                    }

                    textLayer = this.textLayerFactory.createTextLayerBuilder(textLayerDiv, this.id - 1, this.viewport, this.textLayerMode === _ui_utils.TextLayerMode.ENABLE_ENHANCE);
                }

                this.textLayer = textLayer;
                var renderContinueCallback = null;

                if (this.renderingQueue) {
                    renderContinueCallback = function renderContinueCallback(cont) {
                        if (!_this.renderingQueue.isHighestPriority(_this)) {
                            _this.renderingState = _pdf_rendering_queue.RenderingStates.PAUSED;

                            _this.resume = function() {
                                _this.renderingState = _pdf_rendering_queue.RenderingStates.RUNNING;
                                cont();
                            };

                            return;
                        }

                        cont();
                    };
                }

                var finishPaintTask =
                    /*#__PURE__*/
                    function() {
                        var _ref = _asyncToGenerator(
                            /*#__PURE__*/
                            _regenerator["default"].mark(function _callee(error) {
                                return _regenerator["default"].wrap(function _callee$(_context) {
                                    while (1) {
                                        switch (_context.prev = _context.next) {
                                            case 0:
                                                if (paintTask === _this.paintTask) {
                                                    _this.paintTask = null;
                                                }

                                                if (!(error instanceof _pdfjsLib.RenderingCancelledException)) {
                                                    _context.next = 4;
                                                    break;
                                                }

                                                _this.error = null;
                                                return _context.abrupt("return");

                                            case 4:
                                                _this.renderingState = _pdf_rendering_queue.RenderingStates.FINISHED;

                                                if (_this.loadingIconDiv) {
                                                    div.removeChild(_this.loadingIconDiv);
                                                    delete _this.loadingIconDiv;
                                                }

                                                _this._resetZoomLayer(true);

                                                _this.error = error;
                                                _this.stats = pdfPage.stats;

                                                _this.eventBus.dispatch('pagerendered', {
                                                    source: _this,
                                                    pageNumber: _this.id,
                                                    cssTransform: false,
                                                    timestamp: performance.now()
                                                });

                                                if (!error) {
                                                    _context.next = 12;
                                                    break;
                                                }

                                                throw error;

                                            case 12:
                                            case "end":
                                                return _context.stop();
                                        }
                                    }
                                }, _callee);
                            }));

                        return function finishPaintTask(_x) {
                            return _ref.apply(this, arguments);
                        };
                    }();

                var paintTask = this.renderer === _ui_utils.RendererType.SVG ? this.paintOnSvg(canvasWrapper) : this.paintOnCanvas(canvasWrapper);
                paintTask.onRenderContinue = renderContinueCallback;
                this.paintTask = paintTask;
                var resultPromise = paintTask.promise.then(function() {
                    return finishPaintTask(null).then(function() {
                        if (textLayer) {
                            var readableStream = pdfPage.streamTextContent({
                                normalizeWhitespace: true
                            });
                            textLayer.setTextContentStream(readableStream);
                            textLayer.render();
                        }
                    });
                }, function(reason) {
                    return finishPaintTask(reason);
                });

                if (this.annotationLayerFactory) {
                    if (!this.annotationLayer) {
                        this.annotationLayer = this.annotationLayerFactory.createAnnotationLayerBuilder(div, pdfPage, this.imageResourcesPath, this.renderInteractiveForms, this.l10n);
                    }

                    this.annotationLayer.render(this.viewport, 'display');
                }

                div.setAttribute('data-loaded', true);
                this.eventBus.dispatch('pagerender', {
                    source: this,
                    pageNumber: this.id
                });
                return resultPromise;
            }
        }, {
            key: "paintOnCanvas",
            value: function paintOnCanvas(canvasWrapper) {
                var renderCapability = (0, _pdfjsLib.createPromiseCapability)();
                var result = {
                    promise: renderCapability.promise,
                    onRenderContinue: function onRenderContinue(cont) {
                        cont();
                    },
                    cancel: function cancel() {
                        renderTask.cancel();
                    }
                };
                var viewport = this.viewport;
                var canvas = document.createElement('canvas');
                canvas.id = this.renderingId;
                canvas.setAttribute('hidden', 'hidden');
                var isCanvasHidden = true;

                var showCanvas = function showCanvas() {
                    if (isCanvasHidden) {
                        canvas.removeAttribute('hidden');
                        isCanvasHidden = false;
                    }
                };

                canvasWrapper.appendChild(canvas);
                this.canvas = canvas;
                var ctx = canvas.getContext('2d', {
                    alpha: false
                });
                var outputScale = (0, _ui_utils.getOutputScale)(ctx);
                this.outputScale = outputScale;

                if (this.useOnlyCssZoom) {
                    var actualSizeViewport = viewport.clone({
                        scale: _ui_utils.CSS_UNITS
                    });
                    outputScale.sx *= actualSizeViewport.width / viewport.width;
                    outputScale.sy *= actualSizeViewport.height / viewport.height;
                    outputScale.scaled = true;
                }

                if (this.maxCanvasPixels > 0) {
                    var pixelsInViewport = viewport.width * viewport.height;
                    var maxScale = Math.sqrt(this.maxCanvasPixels / pixelsInViewport);

                    if (outputScale.sx > maxScale || outputScale.sy > maxScale) {
                        outputScale.sx = maxScale;
                        outputScale.sy = maxScale;
                        outputScale.scaled = true;
                        this.hasRestrictedScaling = true;
                    } else {
                        this.hasRestrictedScaling = false;
                    }
                }

                var sfx = (0, _ui_utils.approximateFraction)(outputScale.sx);
                var sfy = (0, _ui_utils.approximateFraction)(outputScale.sy);
                canvas.width = (0, _ui_utils.roundToDivide)(viewport.width * outputScale.sx, sfx[0]);
                canvas.height = (0, _ui_utils.roundToDivide)(viewport.height * outputScale.sy, sfy[0]);
                canvas.style.width = (0, _ui_utils.roundToDivide)(viewport.width, sfx[1]) + 'px';
                canvas.style.height = (0, _ui_utils.roundToDivide)(viewport.height, sfy[1]) + 'px';
                canvas.style.background = '#FF80ED';
                this.paintedViewportMap.set(canvas, viewport);
                var transform = !outputScale.scaled ? null : [outputScale.sx, 0, 0, outputScale.sy, 0, 0];
                var renderContext = {
                    // background: 'rgba(0, 255, 145, 0.26)',
                    canvasContext: ctx,
                    transform: transform,
                    viewport: this.viewport,
                    enableWebGL: this.enableWebGL,
                    renderInteractiveForms: this.renderInteractiveForms
                };
                var renderTask = this.pdfPage.render(renderContext);

                renderTask.onContinue = function(cont) {
                    showCanvas();

                    if (result.onRenderContinue) {
                        result.onRenderContinue(cont);
                    } else {
                        cont();
                    }
                };

                renderTask.promise.then(function() {
                    showCanvas();
                    renderCapability.resolve(undefined);
                }, function(error) {
                    showCanvas();
                    renderCapability.reject(error);
                });
                return result;
            }
        }, {
            key: "paintOnSvg",
            value: function paintOnSvg(wrapper) {
                return {
                    promise: Promise.reject(new Error('SVG rendering is not supported.')),
                    onRenderContinue: function onRenderContinue(cont) {},
                    cancel: function cancel() {}
                };
            }
        }, {
            key: "setPageLabel",
            value: function setPageLabel(label) {
                this.pageLabel = typeof label === 'string' ? label : null;

                if (this.pageLabel !== null) {
                    this.div.setAttribute('data-page-label', this.pageLabel);
                } else {
                    this.div.removeAttribute('data-page-label');
                }
            }
        }, {
            key: "width",
            get: function get() {
                return this.viewport.width;
            }
        }, {
            key: "height",
            get: function get() {
                return this.viewport.height;
            }
        }]);

        return PDFPageView;
    }();

exports.PDFPageView = PDFPageView;